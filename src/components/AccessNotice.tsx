import { ShieldAlert } from "lucide-react";

/**
 * Shown in place of a staff-only page when the viewer lacks the role. The
 * page must not load or send any of its data before deciding to render this.
 */
export function AccessNotice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
        <ShieldAlert className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{children}</p>
    </div>
  );
}
