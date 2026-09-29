"use client";

import * as React from "react";

/**
 * Which editors on the course page hold unsaved changes — so switching the
 * content language, closing a lesson or leaving the page can ask first
 * instead of silently throwing work away.
 *
 * Each editor reports through useDirty (or wraps an editor it doesn't own in
 * <DirtyScope>); an editor that unmounts drops out on its own. Kept in a ref,
 * not state: reporting a change must not re-render the whole page.
 */

interface Entry {
  /** What the confirm lists, e.g. "2. Skill concept". */
  label: string;
  /** Discarded by a language switch (the editor is keyed by language). */
  langBound: boolean;
}

interface Registry {
  report(id: string, entry: Entry | null): void;
  /** Labels of dirty editors (each once), optionally only some of them. */
  dirtyLabels(filter?: { langBound?: boolean; idPrefix?: string }): string[];
}

const DirtyContext = React.createContext<Registry | null>(null);

export function DirtyProvider({ children }: { children: React.ReactNode }) {
  const entries = React.useRef(new Map<string, Entry>());

  const registry = React.useMemo<Registry>(
    () => ({
      report(id, entry) {
        if (entry) entries.current.set(id, entry);
        else entries.current.delete(id);
      },
      dirtyLabels(filter = {}) {
        const labels = new Set<string>();
        for (const [id, e] of entries.current) {
          if (
            filter.langBound !== undefined &&
            e.langBound !== filter.langBound
          ) {
            continue;
          }
          if (filter.idPrefix && !id.startsWith(filter.idPrefix)) continue;
          labels.add(e.label);
        }
        return [...labels];
      },
    }),
    []
  );

  // Reloading or closing the tab: let the browser ask (it shows its own text).
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (entries.current.size === 0) return;
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <DirtyContext.Provider value={registry}>{children}</DirtyContext.Provider>
  );
}

/** The registry, for asking "is anything unsaved?" before a change. */
export function useDirtyRegistry(): Registry {
  const registry = React.useContext(DirtyContext);
  if (!registry) throw new Error("useDirtyRegistry needs a <DirtyProvider>");
  return registry;
}

/**
 * Report whether the calling editor has unsaved changes. Returns a stable
 * callback (safe as an effect dependency or an `onDirtyChange` prop); the
 * entry is removed when the caller unmounts.
 */
export function useDirty(id: string, label: string, langBound = false) {
  const registry = useDirtyRegistry();
  React.useEffect(() => () => registry.report(id, null), [registry, id]);
  return React.useCallback(
    (dirty: boolean) =>
      registry.report(id, dirty ? { label, langBound } : null),
    [registry, id, label, langBound]
  );
}

/**
 * useDirty for an editor this page doesn't own: mounts and unmounts with it,
 * and hands it the reporter as a render prop —
 * `<DirtyScope …>{(report) => <Tool onDirtyChange={report} />}</DirtyScope>`.
 */
export function DirtyScope({
  id,
  label,
  langBound = false,
  children,
}: {
  id: string;
  label: string;
  langBound?: boolean;
  children: (report: (dirty: boolean) => void) => React.ReactNode;
}) {
  const report = useDirty(id, label, langBound);
  return <>{children(report)}</>;
}
