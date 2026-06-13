import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "primary" | "accent" | "success" | "muted";
}) {
  const styles = {
    default:
      "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
    primary:
      "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]",
    accent:
      "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]",
    success:
      "border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)]",
    muted:
      "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted-foreground)]",
  }[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles,
        className
      )}
      {...props}
    />
  );
}
