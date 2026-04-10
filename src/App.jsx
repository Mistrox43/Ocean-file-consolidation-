import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { REGIONAL_AUTHORITIES, FILE_TYPES, DUP_CONFIG, TYPE_COLORS, matchFolderToRA } from "./constants";
import { WorkerBridge } from "./workerBridge";
import Badge from "./components/Badge";
import ProgressBar from "./components/ProgressBar";
import DuplicateReport from "./components/DuplicateReport";

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const [selectedRA, setSelectedRA] = useState("");
  const [fileMetas, setFileMetas] = useState([]);
  const [errors, setErrors] = useState([]);
  const [dupResults, setDupResults] = useState({});
  const [progress, setProgress] = useState(null);
  const fileRef = useRef();
  const folderRef = useRef();
  const bridgeRef = useRef(null);

  // Initialize worker bridge once
  useEffect(() => {
    const bridge = new WorkerBridge();
    let rafId = null;
    let latestProgress = null;

    bridge.onProgress((msg) => {
      latestProgress = msg;
      if (rafId == null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (latestProgress) {
            setProgress((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                current: latestProgress.rowsProcessed,
                total: latestProgress.totalRows || prev.total,
              };
            });
          }
        });
      }
    });

    bridgeRef.current = bridge;
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      bridge.terminate();
    };
  }, []);

  const handleFolderUpload = useCallback(async (e) => {
    setErrors([]);
    const bridge = bridgeRef.current;
    if (!bridge) return;

    const filesArr = Array.from(e.target.files);
    const byFolder = {};
    for (const file of filesArr) {
      if (!file.name.toLowerCase().endsWith(".csv")) continue;
      const path = file.webkitRelativePath || "";
      const parts = path.split("/");
      let folderName = "";
      if (parts.length >= 3) {
        folderName = parts[parts.length - 2];
      } else if (parts.length === 2) {
        folderName = parts[0];
      }
      if (!folderName) continue;
      if (!byFolder[folderName]) byFolder[folderName] = [];
      byFolder[folderName].push(file);
    }

    const newMetas = [];
    const newErrors = [];

    for (const [folderName, folderFiles] of Object.entries(byFolder)) {
      const ra = matchFolderToRA(folderName);
      if (!ra) {
        newErrors.push(`Folder "${folderName}": Could not match to a Regional Authority.`);
        continue;
      }
      for (const file of folderFiles) {
        const fileId = crypto.randomUUID();
        setProgress({ action: "parsing", label: `Parsing ${file.name}...`, current: 0, total: null });
        try {
          const result = await bridge.parseFile(fileId, file, ra.name, ra.number, ra.org);
          newMetas.push({
            id: fileId,
            fileName: file.name,
            raName: ra.name,
            raNumber: ra.number,
            raOrg: ra.org,
            typeKey: result.typeKey,
            typeLabel: result.typeLabel,
            rowCount: result.rowCount,
            colCount: result.colCount,
            headers: result.headers,
            headerFingerprint: result.headerFingerprint,
          });
        } catch (err) {
          newErrors.push(`${file.name} (${folderName}): ${err.message}`);
        }
      }
    }

    setProgress(null);
    if (newErrors.length) setErrors(newErrors);
    if (newMetas.length) setFileMetas((prev) => [...prev, ...newMetas]);
    e.target.value = "";
  }, []);

  const handleFiles = useCallback(
    async (e) => {
      const ra = REGIONAL_AUTHORITIES.find((r) => String(r.number) === selectedRA);
      if (!ra) return;
      const bridge = bridgeRef.current;
      if (!bridge) return;

      setErrors([]);
      const newMetas = [];
      const newErrors = [];

      for (const file of e.target.files) {
        if (!file.name.toLowerCase().endsWith(".csv")) {
          newErrors.push(`${file.name}: Not a CSV file.`);
          continue;
        }
        const fileId = crypto.randomUUID();
        setProgress({ action: "parsing", label: `Parsing ${file.name}...`, current: 0, total: null });
        try {
          const result = await bridge.parseFile(fileId, file, ra.name, ra.number, ra.org);
          newMetas.push({
            id: fileId,
            fileName: file.name,
            raName: ra.name,
            raNumber: ra.number,
            raOrg: ra.org,
            typeKey: result.typeKey,
            typeLabel: result.typeLabel,
            rowCount: result.rowCount,
            colCount: result.colCount,
            headers: result.headers,
            headerFingerprint: result.headerFingerprint,
          });
        } catch (err) {
          newErrors.push(`${file.name}: ${err.message}`);
        }
      }

      setProgress(null);
      if (newErrors.length) setErrors(newErrors);
      if (newMetas.length) setFileMetas((prev) => [...prev, ...newMetas]);
      e.target.value = "";
    },
    [selectedRA]
  );

  const removeFile = useCallback((id) => {
    setFileMetas((prev) => prev.filter((f) => f.id !== id));
    setDupResults({});
    bridgeRef.current?.removeFile(id);
  }, []);

  const grouped = useMemo(() => {
    const g = {};
    for (const f of fileMetas) {
      if (!g[f.typeKey]) g[f.typeKey] = [];
      g[f.typeKey].push(f);
    }
    return g;
  }, [fileMetas]);

  const runDupCheck = useCallback(
    async (typeKey) => {
      const bridge = bridgeRef.current;
      const files = grouped[typeKey];
      if (!bridge || !files || files.length === 0) return;

      // Check header match on main thread using fingerprints
      const baseFP = files[0].headerFingerprint;
      for (let i = 1; i < files.length; i++) {
        if (files[i].headerFingerprint !== baseFP) {
          setErrors([`Header mismatch in ${files[i].typeLabel}: cannot run duplicate check until headers match.`]);
          return;
        }
      }

      setErrors([]);
      setProgress({ action: "dedup", label: "Checking duplicates...", current: 0, total: null });
      try {
        const fileIds = files.map((f) => f.id);
        const result = await bridge.checkDuplicates(typeKey, fileIds);
        setDupResults((prev) => ({ ...prev, [typeKey]: result }));
      } catch (err) {
        setErrors([err.message]);
      }
      setProgress(null);
    },
    [grouped]
  );

  const generateForType = useCallback(
    async (typeKey, dedup = false) => {
      const bridge = bridgeRef.current;
      const files = grouped[typeKey];
      if (!bridge || !files || files.length === 0) return;

      const baseFP = files[0].headerFingerprint;
      for (let i = 1; i < files.length; i++) {
        if (files[i].headerFingerprint !== baseFP) {
          setErrors([
            `Header mismatch in ${files[i].typeLabel}: "${files[i].fileName}" (${files[i].raName}) has different columns than "${files[0].fileName}" (${files[0].raName}). All files of the same type must have identical headers.`,
          ]);
          return;
        }
      }

      setErrors([]);
      setProgress({ action: "consolidating", label: "Building CSV...", current: 0, total: null });
      try {
        const fileIds = files.map((f) => f.id);
        const result = await bridge.buildCSV(typeKey, fileIds, dedup);
        const blob = new Blob(result.parts, { type: "text/csv;charset=utf-8;" });
        const ft = FILE_TYPES.find((t) => t.key === typeKey);
        const label = ft.label.replace(/\s+/g, "_");
        const suffix = dedup ? "_Deduplicated" : "";
        downloadBlob(blob, `Consolidated_${label}${suffix}_${formatDate()}.csv`);
      } catch (err) {
        setErrors([err.message]);
      }
      setProgress(null);
    },
    [grouped]
  );

  const generateAll = useCallback(async () => {
    const allKeys = Object.keys(grouped);
    for (const k of allKeys) {
      const files = grouped[k];
      const baseFP = files[0].headerFingerprint;
      for (let i = 1; i < files.length; i++) {
        if (files[i].headerFingerprint !== baseFP) {
          setErrors([
            `Header mismatch in ${files[i].typeLabel}: "${files[i].fileName}" (${files[i].raName}) has different columns than "${files[0].fileName}" (${files[0].raName}).`,
          ]);
          return;
        }
      }
    }
    setErrors([]);
    for (const k of allKeys) {
      await generateForType(k);
    }
  }, [grouped, generateForType]);

  const totalRows = fileMetas.reduce((s, f) => s + f.rowCount, 0);

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif", maxWidth: 960, margin: "0 auto", padding: "32px 20px", color: "#1a1a2e" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>Ocean CSV Consolidator</h1>
        <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 14 }}>Upload Regional Authority exports, merge by type, download consolidated files.</p>
      </div>

      {/* Upload controls */}
      <div style={{ marginBottom: 24, padding: 20, background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 }}>Regional Authority</label>
            <select
              value={selectedRA}
              onChange={(e) => setSelectedRA(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14, background: "#fff", cursor: "pointer" }}
            >
              <option value="">Select an RA…</option>
              <optgroup label="Amplify">
                {REGIONAL_AUTHORITIES.filter((r) => r.org === "Amplify").map((r) => (
                  <option key={r.number} value={r.number}>
                    {r.name} — {r.number}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Ontario Health">
                {REGIONAL_AUTHORITIES.filter((r) => r.org === "Ontario Health").map((r) => (
                  <option key={r.number} value={r.number}>
                    {r.name} — {r.number}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <input ref={fileRef} type="file" accept=".csv" multiple onChange={handleFiles} style={{ display: "none" }} />
            <button
              onClick={() => selectedRA && fileRef.current?.click()}
              disabled={!selectedRA}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: selectedRA ? "#1e40af" : "#94a3b8",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: selectedRA ? "pointer" : "not-allowed",
                transition: "background 0.15s",
              }}
            >
              Upload CSV(s)
            </button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 16, paddingTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 }}>Folder Upload</div>
          <input ref={folderRef} type="file" webkitdirectory="" directory="" onChange={handleFolderUpload} style={{ display: "none" }} />
          <button
            onClick={() => folderRef.current?.click()}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              border: "1px dashed #7c3aed",
              background: "#faf5ff",
              color: "#7c3aed",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s",
            }}
          >
            Upload Folder
          </button>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Auto-detects RA from folder name (Amplify parent folder or OH Network folder)</span>
        </div>
      </div>

      {/* Progress */}
      {progress && <ProgressBar label={progress.label} current={progress.current} total={progress.total} />}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{ marginBottom: 20, padding: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10 }}>
          {errors.map((e, i) => (
            <div key={i} style={{ fontSize: 13, color: "#991b1b", marginBottom: i < errors.length - 1 ? 6 : 0 }}>⚠ {e}</div>
          ))}
        </div>
      )}

      {/* Summary bar */}
      {fileMetas.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            {fileMetas.length} file{fileMetas.length !== 1 ? "s" : ""} · {totalRows.toLocaleString()} rows · {Object.keys(grouped).length} type{Object.keys(grouped).length !== 1 ? "s" : ""}
          </span>
          {Object.keys(grouped).length > 0 && (
            <button
              onClick={generateAll}
              disabled={!!progress}
              style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: progress ? "#94a3b8" : "#059669", color: "#fff", fontSize: 13, fontWeight: 600, cursor: progress ? "not-allowed" : "pointer" }}
            >
              Generate All ({Object.keys(grouped).length})
            </button>
          )}
        </div>
      )}

      {/* File groups */}
      {FILE_TYPES.map((ft) => {
        const files = grouped[ft.key];
        if (!files) return null;
        return (
          <div key={ft.key} style={{ marginBottom: 20, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f1f5f9" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Badge color={TYPE_COLORS[ft.key]}>{ft.label}</Badge>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  {files.length} file{files.length !== 1 ? "s" : ""} · {files.reduce((s, f) => s + f.rowCount, 0).toLocaleString()} rows
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {DUP_CONFIG[ft.key] && (
                  <button
                    onClick={() => runDupCheck(ft.key)}
                    disabled={!!progress}
                    style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", fontSize: 12, fontWeight: 600, cursor: progress ? "not-allowed" : "pointer", color: "#7c3aed" }}
                  >
                    Check Duplicates
                  </button>
                )}
                {dupResults[ft.key] && dupResults[ft.key].duplicates.length > 0 ? (
                  <>
                    <button
                      onClick={() => generateForType(ft.key, false)}
                      disabled={!!progress}
                      style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", fontSize: 12, fontWeight: 600, cursor: progress ? "not-allowed" : "pointer", color: "#1e40af" }}
                    >
                      Download with Duplicates
                    </button>
                    <button
                      onClick={() => generateForType(ft.key, true)}
                      disabled={!!progress}
                      style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #059669", background: "#059669", fontSize: 12, fontWeight: 600, cursor: progress ? "not-allowed" : "pointer", color: "#fff" }}
                    >
                      Download without Duplicates
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => generateForType(ft.key, false)}
                    disabled={!!progress}
                    style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", fontSize: 12, fontWeight: 600, cursor: progress ? "not-allowed" : "pointer", color: "#1e40af" }}
                  >
                    Download CSV
                  </button>
                )}
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ textAlign: "left", padding: "8px 16px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>File</th>
                  <th style={{ textAlign: "left", padding: "8px 16px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Regional Authority</th>
                  <th style={{ textAlign: "left", padding: "8px 16px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Org</th>
                  <th style={{ textAlign: "right", padding: "8px 16px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Rows</th>
                  <th style={{ textAlign: "right", padding: "8px 16px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Cols</th>
                  <th style={{ padding: "8px 16px", borderBottom: "1px solid #e2e8f0" }}></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 16px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{f.fileName}</td>
                    <td style={{ padding: "8px 16px" }}>{f.raName} — {f.raNumber}</td>
                    <td style={{ padding: "8px 16px", color: "#64748b" }}>{f.raOrg}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{f.rowCount.toLocaleString()}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{f.colCount}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right" }}>
                      <button
                        onClick={() => removeFile(f.id)}
                        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                        title="Remove file"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dupResults[ft.key] && <DuplicateReport result={dupResults[ft.key]} />}
          </div>
        );
      })}

      {fileMetas.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#94a3b8" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>No files uploaded yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Select a Regional Authority and upload CSV files to get started.</div>
        </div>
      )}
    </div>
  );
}
