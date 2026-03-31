"use client";

export function AdsChart() {
  return (
    <div className="rounded-lg p-6" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
      <h3 className="text-base font-semibold text-white mb-4">Ad Spend (30 days)</h3>
      <div className="flex items-center justify-center h-48 text-sm" style={{ color: "#9ca3af" }}>
        No ad data available yet.
      </div>
    </div>
  );
}
