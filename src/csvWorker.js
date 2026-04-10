import Papa from "papaparse";

const FILE_TYPES = [
  { key: "listings", label: "Export Listings", markers: ["ref", "serviceDescription", "eReferral management"] },
  { key: "sites", label: "Export Sites", markers: ["Site Number", "# of Approved Listings", "EMR"] },
  { key: "users", label: "Export Users", markers: ["UserName", "ClinicianType", "DateOfAgreement"] },
  { key: "referrals", label: "Referral Analytics", markers: ["referralRef", "referralState", "referralCreationDate"] },
];

const DUP_CONFIG = {
  listings: { keyCol: "ref", contextCols: ["title", "siteName", "siteNum"] },
  sites: { keyCol: "Site Number", contextCols: ["Site Name", "EMR"] },
  referrals: { keyCol: "referralRef", contextCols: ["referralState", "referralCreationDate", "recipientName", "siteNum"] },
};

// In-memory store: fileId → { headers, rows, raName, raNumber, raOrg, typeKey, typeLabel, headerFingerprint }
const fileStore = new Map();

function detectFileType(headers) {
  for (const ft of FILE_TYPES) {
    const matched = ft.markers.filter((m) => headers.includes(m));
    if (matched.length >= 2) return ft;
  }
  return null;
}

function toCSVValue(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatRow(cells) {
  return cells.map(toCSVValue).join(",");
}

// --- Command handlers ---

function handleParseFile(msg) {
  const { id, fileId, text, raName, raNumber, raOrg } = msg;
  const rows = [];
  let headers = null;
  let rowCount = 0;

  Papa.parse(text, {
    skipEmptyLines: true,
    step(result) {
      if (!headers) {
        headers = result.data;
      } else {
        rows.push(result.data);
        rowCount++;
        if (rowCount % 50000 === 0) {
          self.postMessage({ type: "progress", id, fileId, rowsProcessed: rowCount });
        }
      }
    },
    complete() {
      if (!headers || headers.length === 0) {
        self.postMessage({ type: "result", id, error: "File is empty or has no headers." });
        return;
      }

      const ft = detectFileType(headers);
      if (!ft) {
        self.postMessage({ type: "result", id, error: "Could not detect file type from headers." });
        return;
      }

      const headerFingerprint = headers.join("\x00");

      fileStore.set(fileId, {
        headers,
        rows,
        raName,
        raNumber,
        raOrg,
        typeKey: ft.key,
        typeLabel: ft.label,
        headerFingerprint,
      });

      self.postMessage({
        type: "result",
        id,
        data: {
          fileId,
          typeKey: ft.key,
          typeLabel: ft.label,
          rowCount: rows.length,
          colCount: headers.length,
          headers,
          headerFingerprint,
        },
      });
    },
    error(err) {
      self.postMessage({ type: "result", id, error: `Parse error: ${err.message}` });
    },
  });
}

function handleRemoveFile(msg) {
  fileStore.delete(msg.fileId);
  self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
}

function handleClearAll(msg) {
  fileStore.clear();
  self.postMessage({ type: "result", id: msg.id, data: { ok: true } });
}

function handleCheckDuplicates(msg) {
  const { id, typeKey, fileIds } = msg;
  const cfg = DUP_CONFIG[typeKey];
  if (!cfg) {
    self.postMessage({ type: "result", id, data: null });
    return;
  }

  // Gather files and validate headers match
  const files = [];
  for (const fid of fileIds) {
    const f = fileStore.get(fid);
    if (f) files.push({ ...f, fileId: fid });
  }
  if (files.length === 0) {
    self.postMessage({ type: "result", id, data: null });
    return;
  }

  const baseFingerprint = files[0].headerFingerprint;
  for (let i = 1; i < files.length; i++) {
    if (files[i].headerFingerprint !== baseFingerprint) {
      self.postMessage({
        type: "result",
        id,
        error: `Header mismatch: cannot run duplicate check until headers match.`,
      });
      return;
    }
  }

  const headers = files[0].headers;
  const keyIdx = headers.indexOf(cfg.keyCol);
  if (keyIdx === -1) {
    self.postMessage({ type: "result", id, data: null });
    return;
  }
  const ctxIdxs = cfg.contextCols.map((c) => headers.indexOf(c));

  // Single-pass grouping by key value
  const groups = new Map();
  let totalRows = 0;
  let rowNum = 1; // 1-based after header

  for (const f of files) {
    for (const row of f.rows) {
      rowNum++;
      totalRows++;
      const keyValue = row[keyIdx] || "";
      if (!keyValue) continue;

      let group = groups.get(keyValue);
      if (!group) {
        group = [];
        groups.set(keyValue, group);
      }
      group.push({
        rowNum,
        keyValue,
        context: ctxIdxs.map((i) => (i >= 0 ? row[i] || "" : "")),
        raName: f.raName,
        raNumber: f.raNumber,
      });

      if (totalRows % 100000 === 0) {
        self.postMessage({ type: "progress", id, rowsProcessed: totalRows });
      }
    }
  }

  // Filter to duplicates only
  const duplicates = [];
  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;
    const uniqueRAs = new Set(entries.map((e) => e.raNumber));
    const scope = uniqueRAs.size > 1 ? "Cross-RA" : "Within RA";
    duplicates.push({ key, count: entries.length, scope, entries });
  }

  self.postMessage({
    type: "result",
    id,
    data: {
      keyCol: cfg.keyCol,
      contextCols: cfg.contextCols,
      duplicates,
      totalRows,
    },
  });
}

function handleBuildCSV(msg) {
  const { id, typeKey, fileIds, dedup } = msg;

  const files = [];
  for (const fid of fileIds) {
    const f = fileStore.get(fid);
    if (f) files.push({ ...f, fileId: fid });
  }
  if (files.length === 0) {
    self.postMessage({ type: "result", id, error: "No files found." });
    return;
  }

  // Validate headers match
  const baseFingerprint = files[0].headerFingerprint;
  for (let i = 1; i < files.length; i++) {
    if (files[i].headerFingerprint !== baseFingerprint) {
      self.postMessage({
        type: "result",
        id,
        error: `Header mismatch in files of type ${typeKey}.`,
      });
      return;
    }
  }

  const headers = files[0].headers;
  const outHeaders = [...headers, "RA Name", "RA Number"];

  // If deduplicating, find duplicate keys first
  const dupCfg = dedup ? DUP_CONFIG[typeKey] : null;
  let dupKeys = null;
  let keyIdx = -1;

  if (dupCfg) {
    keyIdx = headers.indexOf(dupCfg.keyCol);
    if (keyIdx >= 0) {
      const seen = new Map();
      for (const f of files) {
        for (const row of f.rows) {
          const k = row[keyIdx] || "";
          if (k) seen.set(k, (seen.get(k) || 0) + 1);
        }
      }
      dupKeys = new Set();
      for (const [k, count] of seen) {
        if (count > 1) dupKeys.add(k);
      }
    }
  }

  // Build CSV in chunks of Uint8Array
  const encoder = new TextEncoder();
  const parts = [];
  let batch = [formatRow(outHeaders)];
  const emitted = new Set();
  let totalProcessed = 0;
  let totalRows = 0;
  for (const f of files) totalRows += f.rows.length;

  for (const f of files) {
    for (const row of f.rows) {
      const outRow = [...row];
      while (outRow.length < headers.length) outRow.push("");

      if (dupKeys && keyIdx >= 0) {
        const k = row[keyIdx] || "";
        if (k && dupKeys.has(k)) {
          if (emitted.has(k)) {
            totalProcessed++;
            continue;
          }
          emitted.add(k);
          outRow.push(toCSVValue(f.raName), toCSVValue("99999"));
          batch.push(formatRow(outRow));
          totalProcessed++;
          if (batch.length >= 5000) {
            parts.push(encoder.encode(batch.join("\n") + "\n"));
            batch = [];
            self.postMessage({ type: "progress", id, rowsProcessed: totalProcessed, totalRows });
          }
          continue;
        }
      }

      outRow.push(toCSVValue(f.raName), toCSVValue(String(f.raNumber)));
      batch.push(formatRow(outRow));
      totalProcessed++;

      if (batch.length >= 5000) {
        parts.push(encoder.encode(batch.join("\n") + "\n"));
        batch = [];
        self.postMessage({ type: "progress", id, rowsProcessed: totalProcessed, totalRows });
      }
    }
  }

  if (batch.length > 0) {
    parts.push(encoder.encode(batch.join("\n")));
  }

  // Transfer ArrayBuffers
  const transferables = parts.map((p) => p.buffer);
  self.postMessage({ type: "result", id, data: { parts } }, transferables);
}

// --- Message router ---
self.onmessage = function (e) {
  const msg = e.data;
  switch (msg.command) {
    case "parseFile":
      handleParseFile(msg);
      break;
    case "removeFile":
      handleRemoveFile(msg);
      break;
    case "clearAll":
      handleClearAll(msg);
      break;
    case "checkDuplicates":
      handleCheckDuplicates(msg);
      break;
    case "buildCSV":
      handleBuildCSV(msg);
      break;
    default:
      self.postMessage({ type: "result", id: msg.id, error: `Unknown command: ${msg.command}` });
  }
};
