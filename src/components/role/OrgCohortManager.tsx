"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createOrganisation,
  deleteOrganisation,
  createCohort,
  deleteCohort,
} from "@/app/actions/admin";
import type { AdminOrg } from "@/lib/admin-queries";
import {
  Building2,
  Users,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  CalendarDays,
} from "lucide-react";

const inputCls =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

export function OrgCohortManager({ orgs }: { orgs: AdminOrg[] }) {
  const router = useRouter();
  const [orgName, setOrgName] = React.useState("");
  const [orgShort, setOrgShort] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Per-organisation "new cohort" drafts.
  const [drafts, setDrafts] = React.useState<
    Record<string, { name: string; startsAt: string; endsAt: string }>
  >({});
  const draftFor = (id: string) =>
    drafts[id] ?? { name: "", startsAt: "", endsAt: "" };
  const setDraft = (
    id: string,
    patch: Partial<{ name: string; startsAt: string; endsAt: string }>
  ) => setDrafts((d) => ({ ...d, [id]: { ...draftFor(id), ...patch } }));

  function report(res: { ok: boolean; error?: string }) {
    if (res.ok) {
      setError(null);
      router.refresh();
    } else {
      setError(
        res.error === "forbidden"
          ? "Admins only."
          : res.error === "has-cohorts"
            ? "Delete the organisation's cohorts first."
            : res.error === "name-required"
              ? "A name is required."
              : "Something went wrong."
      );
    }
    setPending(null);
  }

  async function onAddOrg() {
    if (!orgName.trim()) return;
    setPending("org");
    const res = await createOrganisation(orgName, orgShort);
    if (res.ok) {
      setOrgName("");
      setOrgShort("");
    }
    report(res);
  }

  async function onAddCohort(orgId: string) {
    const d = draftFor(orgId);
    if (!d.name.trim()) return;
    setPending(`cohort-${orgId}`);
    const res = await createCohort(
      orgId,
      d.name,
      d.startsAt || undefined,
      d.endsAt || undefined
    );
    if (res.ok) setDraft(orgId, { name: "", startsAt: "", endsAt: "" });
    report(res);
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="text-sm text-[var(--danger)] flex items-center gap-1.5" role="alert">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </p>
      ) : null}

      {/* New organisation */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Building2 className="h-4 w-4 text-[var(--accent)]" />
            New organisation
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Name</span>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. ProArbeit"
                className={`${inputCls} w-56`}
              />
            </label>
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Short name</span>
              <input
                value={orgShort}
                onChange={(e) => setOrgShort(e.target.value)}
                placeholder="optional"
                className={`${inputCls} w-36`}
              />
            </label>
            <Button
              size="sm"
              onClick={onAddOrg}
              disabled={!orgName.trim() || pending === "org"}
            >
              {pending === "org" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add organisation
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Organisations + their cohorts */}
      {orgs.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No organisations yet — add the first one above.
        </p>
      ) : (
        orgs.map((org) => (
          <Card key={org.id}>
            {/* Labelled region: lets screen readers (and tests) address one
                organisation's controls without ambiguity. */}
            <CardContent className="p-4" role="region" aria-label={org.name}>
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-[var(--accent)]" />
                <p className="font-semibold">{org.name}</p>
                <Badge variant="muted" className="text-[10px]">
                  {org.shortName}
                </Badge>
                <Badge variant="muted" className="text-[10px]">
                  {org.cohorts.length} cohort
                  {org.cohorts.length === 1 ? "" : "s"}
                </Badge>
                <button
                  type="button"
                  onClick={async () => {
                    setPending(`delorg-${org.id}`);
                    report(await deleteOrganisation(org.id));
                  }}
                  aria-label={`Delete ${org.name}`}
                  className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {org.cohorts.length ? (
                <ul className="space-y-1.5 mb-3">
                  {org.cohorts.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                    >
                      <Users className="h-4 w-4 text-[var(--muted-foreground)]" />
                      <span className="font-medium">{c.name}</span>
                      {c.startsAt || c.endsAt ? (
                        <span className="text-xs text-[var(--muted-foreground)] inline-flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {c.startsAt ?? "…"} → {c.endsAt ?? "…"}
                        </span>
                      ) : null}
                      <Badge variant="accent" className="text-[10px]">
                        {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                      </Badge>
                      <button
                        type="button"
                        onClick={async () => {
                          setPending(`delcohort-${c.id}`);
                          report(await deleteCohort(c.id));
                        }}
                        aria-label={`Delete ${c.name}`}
                        className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)] mb-3">
                  No cohorts yet.
                </p>
              )}

              {/* New cohort in this org */}
              <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
                <label className="text-xs text-[var(--muted-foreground)]">
                  <span className="block mb-1">New cohort</span>
                  <input
                    value={draftFor(org.id).name}
                    onChange={(e) => setDraft(org.id, { name: e.target.value })}
                    placeholder="e.g. Berlin Pilot · Autumn 2026"
                    className={`${inputCls} w-64`}
                  />
                </label>
                <label className="text-xs text-[var(--muted-foreground)]">
                  <span className="block mb-1">Starts</span>
                  <input
                    type="date"
                    value={draftFor(org.id).startsAt}
                    onChange={(e) =>
                      setDraft(org.id, { startsAt: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
                <label className="text-xs text-[var(--muted-foreground)]">
                  <span className="block mb-1">Ends</span>
                  <input
                    type="date"
                    value={draftFor(org.id).endsAt}
                    onChange={(e) =>
                      setDraft(org.id, { endsAt: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAddCohort(org.id)}
                  disabled={
                    !draftFor(org.id).name.trim() ||
                    pending === `cohort-${org.id}`
                  }
                >
                  {pending === `cohort-${org.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add cohort
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
