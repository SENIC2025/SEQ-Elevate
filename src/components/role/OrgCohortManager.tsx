"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InlineConfirm } from "@/components/ui/inline-confirm";
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

/** What a refused change means, in plain words. */
function errorText(error?: string): string {
  switch (error) {
    case "forbidden":
      return "Admins only.";
    case "has-cohorts":
      return "Delete the organisation's cohorts first.";
    case "name-required":
      return "A name is required.";
    case "no-answer":
      return "There was no answer from the server. Reload the page to see whether it was done.";
    default:
      return "Something went wrong.";
  }
}

/** What is being asked about before it is deleted. */
type Asking = { kind: "org" | "cohort"; id: string } | null;

export function OrgCohortManager({ orgs }: { orgs: AdminOrg[] }) {
  const router = useRouter();
  const [orgName, setOrgName] = React.useState("");
  const [orgShort, setOrgShort] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // The list the last change returned, shown until the page's own list
  // (`orgs`) is rendered again: the refresh after a change sometimes
  // doesn't show until the next router update (see actions/admin.ts).
  const [fresh, setFresh] = React.useState<{
    from: AdminOrg[];
    list: AdminOrg[];
  } | null>(null);
  const shown = fresh && fresh.from === orgs ? fresh.list : orgs;

  const ids = React.useId();
  const binId = (kind: "org" | "cohort", id: string) => `${ids}-del-${kind}-${id}`;
  const [confirming, setConfirming] = React.useState<Asking>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const isAsking = (kind: "org" | "cohort", id: string) =>
    confirming?.kind === kind && confirming.id === id;
  // Where focus goes once the list has changed (the counter repeats a move).
  const [focus, setFocus] = React.useState<{ id: string; n: number } | null>(null);
  const focusEl = (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  React.useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);

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

  function report(res: { ok: boolean; error?: string; orgs?: AdminOrg[] | null }) {
    if (res.ok) {
      if (res.orgs) setFresh({ from: orgs, list: res.orgs });
      setError(null);
      router.refresh();
    } else {
      setError(errorText(res.error));
    }
    setPending(null);
  }

  /**
   * The bins ask first. An organisation that still has cohorts can't be
   * deleted, so its bin says so instead of asking.
   */
  function ask(kind: "org" | "cohort", id: string) {
    const org = kind === "org" ? shown.find((o) => o.id === id) : null;
    if (org && org.cohorts.length > 0) {
      setError(errorText("has-cohorts"));
      return;
    }
    setError(null);
    setConfirmError(null);
    setConfirming({ kind, id });
  }

  function keep(kind: "org" | "cohort", id: string) {
    setConfirming(null);
    setConfirmError(null);
    focusEl(binId(kind, id));
  }

  /**
   * Deletes what was asked about. Focus then goes to the next one in its
   * list (or the one before, at the end); with none left, to the field that
   * adds one.
   */
  async function onDelete(kind: "org" | "cohort", id: string, org: AdminOrg) {
    setPending(kind === "org" ? `delorg-${id}` : `delcohort-${id}`);
    setConfirmError(null);
    const list = kind === "org" ? shown : org.cohorts;
    const at = list.findIndex((x) => x.id === id);
    const near = list[at + 1] ?? list[at - 1];
    let res: Awaited<ReturnType<typeof deleteOrganisation | typeof deleteCohort>>;
    try {
      res = kind === "org" ? await deleteOrganisation(id) : await deleteCohort(id);
    } catch {
      // A dropped connection or a server error: the question stays, says
      // so, and can be tried again or kept.
      setConfirmError(errorText("no-answer"));
      setPending(null);
      return;
    }
    if (!res.ok) {
      setConfirmError(errorText(res.error));
      setPending(null);
      return;
    }
    setConfirming(null);
    report(res);
    focusEl(
      near && near.id !== id
        ? binId(kind, near.id)
        : kind === "org"
          ? `${ids}-org-name`
          : `${ids}-new-cohort-${org.id}`
    );
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
                id={`${ids}-org-name`}
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
      {shown.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No organisations yet — add the first one above.
        </p>
      ) : (
        shown.map((org) => (
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
                  id={binId("org", org.id)}
                  type="button"
                  onClick={() => ask("org", org.id)}
                  aria-label={`Delete ${org.name}`}
                  className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>

              {isAsking("org", org.id) ? (
                <div className="mb-3">
                  <InlineConfirm
                    heading="h2"
                    title={`Delete the organisation “${org.name}”?`}
                    confirmLabel="Delete organisation"
                    keepLabel="Keep it"
                    busy={pending === `delorg-${org.id}`}
                    error={confirmError}
                    onConfirm={() => onDelete("org", org.id, org)}
                    onKeep={() => keep("org", org.id)}
                  >
                    <p className="mt-1 text-xs">
                      It has no cohorts. People linked to it keep their
                      accounts and data.
                    </p>
                  </InlineConfirm>
                </div>
              ) : null}

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
                        id={binId("cohort", c.id)}
                        type="button"
                        onClick={() => ask("cohort", c.id)}
                        aria-label={`Delete ${c.name}`}
                        className="ml-auto rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                      {isAsking("cohort", c.id) ? (
                        <div className="basis-full">
                          <InlineConfirm
                            heading="h2"
                            title={`Delete the cohort “${c.name}”?`}
                            confirmLabel="Delete cohort"
                            keepLabel="Keep it"
                            busy={pending === `delcohort-${c.id}`}
                            error={confirmError}
                            onConfirm={() => onDelete("cohort", c.id, org)}
                            onKeep={() => keep("cohort", c.id)}
                          >
                            <p className="mt-1 text-xs">
                              {c.memberCount === 0
                                ? "Nobody is in it."
                                : c.memberCount === 1
                                  ? "Its 1 member will have no cohort. Their account and data stay."
                                  : `Its ${c.memberCount} members will have no cohort. Their accounts and data stay.`}
                            </p>
                          </InlineConfirm>
                        </div>
                      ) : null}
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
                    id={`${ids}-new-cohort-${org.id}`}
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
