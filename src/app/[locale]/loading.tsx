export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center py-24" aria-busy="true">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
