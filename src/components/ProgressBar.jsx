export default function ProgressBar({ label, current, total }) {
  const pct = total ? Math.min(100, Math.round((current / total) * 100)) : null;

  return (
    <div style={{ marginBottom: 20, padding: 16, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10 }}>
      <div style={{ fontSize: 13, color: "#1e40af", fontWeight: 600, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        {current > 0 && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
            {current.toLocaleString()} {total ? `/ ${total.toLocaleString()}` : ""} rows
          </span>
        )}
      </div>
      <div style={{ height: 6, background: "#dbeafe", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            background: "#3b82f6",
            borderRadius: 3,
            width: pct != null ? `${pct}%` : "100%",
            transition: pct != null ? "width 0.2s" : "none",
            animation: pct == null ? "indeterminate 1.5s ease-in-out infinite" : "none",
          }}
        />
      </div>
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); width: 40%; }
          50% { transform: translateX(100%); width: 40%; }
          100% { transform: translateX(-100%); width: 40%; }
        }
      `}</style>
    </div>
  );
}
