import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  label,
  ariaLabel,
}: {
  value: number;
  className?: string;
  label?: string;
  /** Accessible name when there's no visible label. */
  ariaLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <div className="flex justify-between text-xs text-[var(--muted-foreground)] mb-1">
          <span>{label}</span>
          <span>{Math.round(clamped)}%</span>
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)] border border-[var(--border)]"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? ariaLabel ?? "Progress"}
      >
        <div
          className="h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
