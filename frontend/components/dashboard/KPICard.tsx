interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
}

export function KPICard({ title, value, subtitle }: KPICardProps) {
  return (
    <div className="rounded-lg p-6" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
      <p className="text-sm font-medium" style={{ color: "#9ca3af" }}>{title}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
      {subtitle && <p className="mt-1 text-sm" style={{ color: "#9ca3af" }}>{subtitle}</p>}
    </div>
  );
}
