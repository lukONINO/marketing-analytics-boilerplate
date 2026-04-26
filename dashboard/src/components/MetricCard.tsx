import clsx from "clsx";
import { InfoTooltip } from "@/components/InfoTooltip";

type Accent = "blue" | "purple" | "fuchsia" | "emerald" | "slate" | "amber" | "red";

const ACCENT_TEXT: Record<Accent, string> = {
  blue:     "text-primary-800",
  purple:   "text-accent-700",
  fuchsia:  "text-accent-600",
  emerald:  "text-success-600",
  slate:    "text-ink-900",
  amber:    "text-warning-600",
  red:      "text-danger-600",
};

export interface MetricCardProps {
  label: string;
  value: number | string | null | undefined;
  accent?: Accent;
  unit?: string;
  sublabel?: string;
  info?: React.ReactNode;
}

export function MetricCard({ label, value, accent = "slate", unit, sublabel, info }: MetricCardProps) {
  const display =
    value === null || value === undefined || value === ""
      ? "—"
      : typeof value === "number"
      ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
      : value;

  return (
    <div className="bg-surface rounded-xl border border-hairline p-4 shadow-card hover:shadow-card-hover hover:border-hairline-subtle transition-all">
      <div className="flex items-center gap-1.5">
        <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500 font-semibold">{label}</div>
        {info && <InfoTooltip content={info} label={`About ${label}`} />}
      </div>
      <div className={clsx("text-2xl font-semibold mt-1 tabular-nums tracking-tight", ACCENT_TEXT[accent])}>
        {display}
        {unit && <span className="text-base font-normal text-ink-500 ml-1">{unit}</span>}
      </div>
      {sublabel && <div className="text-xs text-ink-500 mt-1">{sublabel}</div>}
    </div>
  );
}
