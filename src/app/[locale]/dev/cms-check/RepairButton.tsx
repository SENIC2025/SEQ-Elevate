"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { repairOutline } from "@/app/actions/sections";

/**
 * The developer probe's repair (addendum 10), for admins: resets what can't
 * be read in one course's lesson list and lesson content to the standard
 * layout, keeping the old values in the audit log. The server checks the
 * admin role again.
 */
export function RepairButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "failed">("idle");
  return (
    <span className="ml-2 inline-flex items-center gap-2">
      <button
        type="button"
        className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--surface-muted)]"
        disabled={state === "busy"}
        onClick={async () => {
          if (!window.confirm(`Reset what can't be read in "${slug}" to the standard layout?`)) return;
          setState("busy");
          try {
            const res = await repairOutline(slug);
            setState(res.ok ? "done" : "failed");
            if (res.ok) router.refresh();
          } catch {
            setState("failed");
          }
        }}
      >
        Repair
      </button>
      <span role="status" className="text-xs">
        {state === "done" ? "Repaired." : state === "failed" ? "Couldn't repair it." : ""}
      </span>
    </span>
  );
}
