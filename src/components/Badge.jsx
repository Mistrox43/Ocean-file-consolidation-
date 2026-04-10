export default function Badge({ children, color }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        background: color === "blue" ? "#dbeafe" : color === "green" ? "#d1fae5" : color === "amber" ? "#fef3c7" : color === "rose" ? "#ffe4e6" : "#f3f4f6",
        color: color === "blue" ? "#1e40af" : color === "green" ? "#065f46" : color === "amber" ? "#92400e" : color === "rose" ? "#9f1239" : "#374151",
      }}
    >
      {children}
    </span>
  );
}
