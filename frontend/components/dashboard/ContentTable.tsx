export function ContentTable() {
  return (
    <div className="rounded-lg" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
      <div className="p-6" style={{ borderBottom: "1px solid #222222" }}>
        <h3 className="text-base font-semibold text-white">Recent Content</h3>
      </div>
      <div className="p-6">
        <p className="text-sm text-center py-8" style={{ color: "#9ca3af" }}>No content published yet.</p>
      </div>
    </div>
  );
}
