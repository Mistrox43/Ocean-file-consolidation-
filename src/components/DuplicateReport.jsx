import { useCallback, useMemo } from "react";
import { List } from "react-window";
import Badge from "./Badge";

const HEADER_HEIGHT = 52;
const ROW_HEIGHT = 32;
const TABLE_HEADER_HEIGHT = 30;
const MAX_LIST_HEIGHT = 400;

function DupGroup({ dup, dr, showBorder }) {
  return (
    <div style={{ borderTop: showBorder ? "1px solid #f1f5f9" : "none" }}>
      <div style={{ padding: "10px 16px", background: "#fffbeb", display: "flex", gap: 12, alignItems: "center", fontSize: 12 }}>
        <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{dr.keyCol}: {dup.key}</span>
        <Badge color={dup.scope === "Cross-RA" ? "rose" : "amber"}>{dup.scope}</Badge>
        <span style={{ color: "#64748b" }}>{dup.count} occurrences</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            <th style={{ textAlign: "right", padding: "6px 12px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Row</th>
            {dr.contextCols.map((c, ci) => (
              <th key={ci} style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>{c}</th>
            ))}
            <th style={{ textAlign: "left", padding: "6px 12px", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>RA Name</th>
          </tr>
        </thead>
        <tbody>
          {dup.entries.map((entry, ei) => (
            <tr key={ei} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{entry.rowNum}</td>
              {entry.context.map((v, ci) => (
                <td key={ci} style={{ padding: "6px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</td>
              ))}
              <td style={{ padding: "6px 12px" }}>{entry.raName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DuplicateReport({ result }) {
  const dr = result;
  const duplicates = useMemo(() => dr?.duplicates ?? [], [dr]);

  const getItemHeight = useCallback(
    (index) => {
      const dup = duplicates[index];
      return HEADER_HEIGHT + TABLE_HEADER_HEIGHT + dup.entries.length * ROW_HEIGHT + 4;
    },
    [duplicates]
  );

  if (!dr) return null;

  if (duplicates.length === 0) {
    return (
      <div style={{ padding: 16, background: "#f0fdf4", borderTop: "1px solid #e2e8f0", fontSize: 13, color: "#166534" }}>
        ✓ No duplicates found in {dr.keyCol} across {dr.totalRows.toLocaleString()} rows.
      </div>
    );
  }

  const totalHeight = duplicates.reduce((sum, dup) => sum + HEADER_HEIGHT + TABLE_HEADER_HEIGHT + dup.entries.length * ROW_HEIGHT + 4, 0);
  const listHeight = Math.min(totalHeight, MAX_LIST_HEIGHT);

  const useVirtualization = duplicates.length > 50;

  return (
    <div style={{ borderTop: "1px solid #e2e8f0" }}>
      <div style={{ padding: "12px 16px", background: "#fefce8", fontSize: 13, color: "#854d0e" }}>
        ⚠ {duplicates.length} duplicate {dr.keyCol} value{duplicates.length !== 1 ? "s" : ""} found ({duplicates.reduce((s, d) => s + d.count, 0)} total rows affected)
      </div>
      {useVirtualization ? (
        <List
          height={listHeight}
          itemCount={duplicates.length}
          itemHeight={getItemHeight}
          width="100%"
          overscanCount={5}
        >
          {({ index, style }) => (
            <div style={style}>
              <DupGroup dup={duplicates[index]} dr={dr} showBorder={index > 0} />
            </div>
          )}
        </List>
      ) : (
        <div style={{ maxHeight: MAX_LIST_HEIGHT, overflow: "auto" }}>
          {duplicates.map((dup, di) => (
            <DupGroup key={di} dup={dup} dr={dr} showBorder={di > 0} />
          ))}
        </div>
      )}
    </div>
  );
}
