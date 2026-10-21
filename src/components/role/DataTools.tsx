"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import {
  eraseAccountByAdmin,
  findPeople,
  markTestAccount,
  previewCleanup,
  resetTestAccount,
  runCleanup,
} from "@/app/actions/admin-data";
import type {
  AdminRefusal,
  CleanupPlan,
  CleanupResult,
  FoundPerson,
  LogRow,
  ReviewKey,
  ReviewPerson,
} from "@/lib/account-data";
import { AlertTriangle, CheckCircle2, Download, Loader2, Search, Trash2 } from "lucide-react";

/**
 * Release 3 (spec 8, 13.4, 14; D85, D88): /admin/data, for an ADMIN with
 * project scope. Find anyone by address and export (for a logged request),
 * mark, reset or erase them; review lists of people to mark as test
 * accounts; the clean-up's dry run and run; the log of what was done.
 * English, like the other staff screens. Every action is refused on the
 * server for anyone else (actions/admin-data.ts); this screen only offers.
 */

const inputCls = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
const REF_PATTERN = "REQ-[0-9]{4}-[0-9]{3}";

type Notice = { kind: "ok" | "warn"; text: string };

/** What a refusal means, in plain words. */
function errorText(error?: string, expected?: string): string {
  switch (error) {
    case "forbidden":
      return "Admins only.";
    case "self":
      return "Not on your own account. Another admin can.";
    case "last-admin":
      return "This is the project's last admin.";
    case "admin-email":
      return "This address is on ADMIN_EMAILS, so its roles come back at the next sign-in. Ask SENIC to remove the address from ADMIN_EMAILS first.";
    case "not-test-account":
      return "Only an account marked as a test account can be reset.";
    case "confirmation-mismatch":
      return "The address you typed doesn't match this account.";
    case "request-ref":
      return "Enter the request's reference from the register, as REQ-YYYY-NNN (for example REQ-2026-004). Only a marked test account needs none.";
    case "confirm-mismatch":
      return `To run the clean-up, type exactly: ${expected ?? "ERASE <n> TEST ACCOUNTS"}`;
    case "too-short":
      return "Type at least three characters of the address.";
    case "not-found":
      return "That account no longer exists.";
    case "no-answer":
      return "There was no answer from the server. Reload the page to see whether it was done.";
    default:
      return "Something went wrong.";
  }
}

const REFUSAL_TEXT: Record<AdminRefusal, string> = {
  self: "your own account",
  "last-admin": "the project's last admin",
  "admin-email": "on ADMIN_EMAILS (ask SENIC to remove the address first)",
};

const REVIEW: { key: ReviewKey; title: (from: string | null) => string; desc: string }[] = [
  {
    key: "no-profile",
    title: () => "Learner data, profile not completed",
    desc: "Accounts with progress or a Comp Card that never finished the profile step.",
  },
  {
    key: "showcase",
    title: () => "Showcase profile addresses",
    desc: "The accounts of the one-click showcase profiles, if they exist on this database.",
  },
  {
    key: "before-stats",
    title: (from) => `Learner data from before ${from ?? "the statistics start"}`,
    desc: "Not marked and never staff: testers whose activity before the start would otherwise look like a learner's.",
  },
  {
    key: "staff-with-data",
    title: () => "Staff who also have learner data",
    desc: "People who hold or held a staff role and played courses.",
  },
  {
    key: "member-targets",
    title: () => "Changed on People, never staff",
    desc: "Accounts added or changed on Manage people with no record of a staff role.",
  },
  {
    key: "partner-never-signed-in",
    title: () => "Added by a partner admin, never signed in",
    desc: "With the organisation and the date.",
  },
  {
    key: "country-mismatch",
    title: () => "Country doesn't match organisation",
    desc: "Released by the country rule, or the country maps to another organisation. Change it on Manage people.",
  },
];

export function DataTools({
  review,
  log,
  statsFrom,
}: {
  review: Record<ReviewKey, ReviewPerson[]>;
  log: LogRow[];
  /** The statistics start (YYYY-MM-DD), or null with no date. */
  statsFrom: string | null;
}) {
  const router = useRouter();
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const say = (n: Notice | null) => setNotice(n);

  return (
    <div className="space-y-8">
      {/* Polite live region: what an action did, without moving focus. */}
      <div role="status" aria-live="polite">
        {notice ? <NoticeLine notice={notice} /> : null}
      </div>

      <FindPerson say={say} refresh={() => router.refresh()} />
      <ReviewLists review={review} statsFrom={statsFrom} say={say} refresh={() => router.refresh()} />
      <Cleanup say={say} refresh={() => router.refresh()} />
      <LogViewer log={log} />
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <p
      className={`text-sm flex items-start gap-1.5 rounded-md border px-3 py-2 ${
        notice.kind === "ok"
          ? "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)]"
          : "border-[var(--danger)]/40 text-[var(--danger)]"
      }`}
    >
      {notice.kind === "ok" ? (
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--accent)]" aria-hidden />
      ) : (
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden />
      )}
      {notice.text}
    </p>
  );
}

/** Calls an action; a dropped connection or a server error reads as "no answer". */
async function attempt<T>(call: () => Promise<T>): Promise<T | { ok: false; error: "no-answer" }> {
  try {
    return await call();
  } catch {
    return { ok: false, error: "no-answer" };
  }
}

/* ---------------------------------------------------------- find a person --- */

function FindPerson({ say, refresh }: { say: (n: Notice | null) => void; refresh: () => void }) {
  const ids = React.useId();
  const [query, setQuery] = React.useState("");
  const [people, setPeople] = React.useState<FoundPerson[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const last = React.useRef("");

  async function search(q: string) {
    setBusy(true);
    setError(null);
    const res = await attempt(() => findPeople(q));
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.error));
      return;
    }
    last.current = q;
    setPeople(res.people);
  }

  /** After a change: the list again, and the page's lists and log. */
  async function changed(n: Notice) {
    say(n);
    refresh();
    if (last.current) await search(last.current);
  }

  return (
    <section aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="text-lg font-semibold mb-2">
        Find a person
      </h2>
      <Card>
        <CardContent className="p-4 space-y-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search(query);
            }}
          >
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Email address (or part of it)</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${inputCls} w-72 max-w-full`}
                autoComplete="off"
              />
            </label>
            <Button type="submit" size="sm" disabled={busy || query.trim().length < 3}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              Find
            </Button>
          </form>
          <p className="text-xs text-[var(--muted-foreground)]">
            Anyone with an account, member or not: people removed from the project and accounts that never
            finished the profile step too.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)] flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {error}
            </p>
          ) : null}
          {people ? (
            people.length ? (
              <ul className="space-y-3" aria-label="People found">
                {people.map((p) => (
                  <li key={p.id}>
                    <PersonActions person={p} onChanged={changed} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No account has an address like that.</p>
            )
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}

function PersonActions({ person: p, onChanged }: { person: FoundPerson; onChanged: (n: Notice) => Promise<void> }) {
  const ids = React.useId();
  const [open, setOpen] = React.useState<"export" | "reset" | "erase" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = React.useState("");
  const [ref, setRef] = React.useState("");

  const close = () => {
    setOpen(null);
    setError(null);
    setConfirmEmail("");
    setRef("");
    document.getElementById(`${ids}-actions`)?.focus();
  };

  async function onMark() {
    setBusy(true);
    setError(null);
    const res = await attempt(() => markTestAccount(p.id, !p.testAccount));
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    await onChanged({ kind: "ok", text: `${p.email} is ${res.testAccount ? "now marked" : "no longer marked"} as a test account.` });
  }

  async function onReset() {
    setBusy(true);
    setError(null);
    const res = await attempt(() => resetTestAccount(p.id));
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    setOpen(null);
    await onChanged({ kind: "ok", text: `Reset ${p.email}: its learner data and sessions are gone; the account stays.` });
  }

  async function onErase(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await attempt(() => eraseAccountByAdmin(p.id, { confirmEmail, requestRef: ref.trim() || null }));
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    setOpen(null);
    await onChanged({ kind: "ok", text: `Erased ${p.email}. The log keeps a record without the address.` });
  }

  const facts = [
    p.roles.length ? p.roles.join(", ") : "no role",
    p.organisation ?? "no organisation",
    `${p.enrolments} course${p.enrolments === 1 ? "" : "s"}${p.compCard ? ", a Comp Card" : ""}`,
  ];

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="font-medium break-all">{p.email}</p>
      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
        {p.name ? `${p.name} · ` : ""}
        {facts.join(" · ")}
      </p>
      <p className="mt-1.5 flex flex-wrap gap-1.5">
        {p.testAccount ? <Chip>Test account</Chip> : null}
        {p.profileComplete ? null : <Chip>Profile not completed</Chip>}
        {p.signedIn ? null : <Chip>Never signed in</Chip>}
        {p.everStaff ? <Chip>Staff, now or before</Chip> : null}
      </p>

      <div
        id={`${ids}-actions`}
        tabIndex={-1}
        role="group"
        aria-label={`Actions for ${p.email}`}
        className="mt-3 flex flex-wrap gap-2 outline-none"
      >
        <Button size="sm" variant="outline" onClick={() => setOpen(open === "export" ? null : "export")} aria-expanded={open === "export"}>
          <Download className="h-4 w-4" aria-hidden />
          Export data
        </Button>
        <Button size="sm" variant="outline" onClick={onMark} disabled={busy}>
          {p.testAccount ? "Unmark test account" : "Mark as test account"}
        </Button>
        {p.refusal === null && p.testAccount ? (
          <Button size="sm" variant="outline" onClick={() => setOpen("reset")} aria-expanded={open === "reset"}>
            Reset
          </Button>
        ) : null}
        {p.refusal === null ? (
          <Button size="sm" variant="outline" onClick={() => setOpen("erase")} aria-expanded={open === "erase"}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Erase
          </Button>
        ) : null}
      </div>
      {p.refusal ? (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">Can&apos;t be reset or erased here: {REFUSAL_TEXT[p.refusal]}.</p>
      ) : null}
      {error && open === null ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {open === "export" ? (
        // A plain form: the browser sends this page's origin with it, and
        // downloads the answer (the route refuses anything else).
        <form
          method="post"
          action={`/api/admin/people/${encodeURIComponent(p.id)}/export`}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] p-3"
        >
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Request reference (REQ-YYYY-NNN)</span>
            <input name="requestRef" required pattern={REF_PATTERN} placeholder="REQ-2026-001" className={`${inputCls} w-44`} />
          </label>
          <Button type="submit" size="sm">
            <Download className="h-4 w-4" aria-hidden />
            Download their data
          </Button>
          <p className="w-full text-xs text-[var(--muted-foreground)]">
            The file holds everything about them, their Comp Card and reflections included. The download is
            logged with the reference.
          </p>
        </form>
      ) : null}

      {open === "reset" ? (
        <div className="mt-3">
          <InlineConfirm
            title={`Reset ${p.email}?`}
            confirmLabel="Reset"
            keepLabel="Keep"
            busy={busy}
            error={error}
            onConfirm={onReset}
            onKeep={close}
          >
            <p className="mt-1 text-xs">
              Their sessions end, and their progress, answers, Comp Card, badges and the notes about them are
              deleted. The account, its roles and its profile stay.
            </p>
          </InlineConfirm>
        </div>
      ) : null}

      {open === "erase" ? (
        <form
          onSubmit={onErase}
          role="group"
          aria-labelledby={`${ids}-erase`}
          className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3 space-y-2"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) close();
          }}
        >
          <h3 id={`${ids}-erase`} className="text-sm font-semibold">
            Erase {p.email} for good?
          </h3>
          <p className="text-xs">
            The account and everything linked to it are deleted, with their activity records, sign-in links
            and rate-limit counters. Notes they wrote stay, unsigned. The log keeps one record, with the
            reference and without the address.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Type their address to confirm</span>
              <input
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="off"
                className={`${inputCls} w-64 max-w-full`}
              />
            </label>
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">
                Request reference{p.testAccount ? " (not needed for a test account)" : " (REQ-YYYY-NNN)"}
              </span>
              <input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                pattern={REF_PATTERN}
                required={!p.testAccount}
                placeholder="REQ-2026-001"
                className={`${inputCls} w-44`}
              />
            </label>
          </div>
          {error ? (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="danger" aria-disabled={busy || undefined}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              Erase for good
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => !busy && close()}>
              Keep
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- review lists --- */

function ReviewLists({
  review,
  statsFrom,
  say,
  refresh,
}: {
  review: Record<ReviewKey, ReviewPerson[]>;
  statsFrom: string | null;
  say: (n: Notice | null) => void;
  refresh: () => void;
}) {
  const ids = React.useId();
  return (
    <section aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="text-lg font-semibold">
        People to review
      </h2>
      <p className="mt-1 mb-3 text-sm text-[var(--muted-foreground)]">
        Mark the test accounts among them: statistics leave a marked account out at once, and the clean-up run
        erases it.
      </p>
      <div className="space-y-4">
        {REVIEW.map((r) => (
          <ReviewList
            key={r.key}
            title={r.title(statsFrom)}
            desc={r.desc}
            people={review[r.key]}
            say={say}
            refresh={refresh}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewList({
  title,
  desc,
  people,
  say,
  refresh,
}: {
  title: string;
  desc: string;
  people: ReviewPerson[];
  say: (n: Notice | null) => void;
  refresh: () => void;
}) {
  const ids = React.useId();
  const [ticked, setTicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const unmarked = people.filter((p) => !p.testAccount);

  async function mark(list: string[]) {
    setBusy(true);
    let done = 0;
    let error: string | undefined;
    for (const id of list) {
      const res = await attempt(() => markTestAccount(id, true));
      if (res.ok) done += 1;
      else error = res.error;
    }
    setBusy(false);
    setTicked(new Set());
    say(
      error
        ? { kind: "warn", text: `Marked ${done} of ${list.length}. ${errorText(error)}` }
        : { kind: "ok", text: `Marked ${done} account${done === 1 ? "" : "s"} as test accounts.` }
    );
    refresh();
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold">
          {title} <span className="font-normal text-[var(--muted-foreground)]">({people.length})</span>
        </h3>
        <p className="text-xs text-[var(--muted-foreground)]">{desc}</p>
        {people.length ? (
          <>
            <ul className="mt-2 divide-y divide-[var(--border)]" aria-label={title}>
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  {p.testAccount ? (
                    <span className="break-all">{p.email}</span>
                  ) : (
                    <label className="inline-flex items-center gap-2 break-all">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--accent)]"
                        checked={ticked.has(p.id)}
                        onChange={(e) => {
                          const next = new Set(ticked);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          setTicked(next);
                        }}
                      />
                      {p.email}
                    </label>
                  )}
                  {p.detail ? <span className="text-xs text-[var(--muted-foreground)]">{p.detail}</span> : null}
                  {p.testAccount ? (
                    <Chip>Test account</Chip>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() => mark([p.id])}
                      aria-label={`Mark ${p.email} as a test account`}
                    >
                      Mark as test account
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {unmarked.length > 1 ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busy || ticked.size === 0}
                onClick={() => mark([...ticked])}
                aria-describedby={`${ids}-n`}
              >
                Mark ticked as test accounts
              </Button>
            ) : null}
            <span id={`${ids}-n`} className="sr-only">
              {ticked.size} ticked
            </span>
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No one.</p>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- clean-up --- */

const ROW_LABELS: Record<string, string> = {
  enrolments: "Course progress (enrolments)",
  compCards: "Comp Cards",
  badges: "Badges",
  notesAbout: "Notes about them",
  validationsAbout: "Validations about them",
  missions: "Missions",
  sessions: "Their sessions",
  activity: "Activity records",
  signInLinks: "Their sign-in links",
  rateLimits: "Rate-limit counters",
};

function Counts({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
      {rows.map((r) => (
        <React.Fragment key={r.label}>
          <dt>{r.label}</dt>
          <dd className="text-right tabular-nums">{r.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function fileRows(files: CleanupPlan["files"], done: boolean) {
  return [
    {
      label: done ? "Course files deleted" : "Course files to delete",
      value: files.deleted,
    },
    ...(done ? [{ label: "Course files whose deletion failed (still queued)", value: files.failed }] : []),
    { label: "Course files in use again (taken off the queue)", value: files.dropped },
    {
      label: files.mode === "delete" ? "Course files kept (not our store)" : "Course files kept (not production)",
      value: files.kept,
    },
    { label: "Course files queued less than 7 days ago", value: files.waiting },
  ];
}

function Cleanup({ say, refresh }: { say: (n: Notice | null) => void; refresh: () => void }) {
  const ids = React.useId();
  const [plan, setPlan] = React.useState<CleanupPlan | null>(null);
  const [result, setResult] = React.useState<{ result: CleanupResult; kept: CleanupPlan["kept"] } | null>(null);
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState<"plan" | "run" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const resultRef = React.useRef<HTMLHeadingElement>(null);
  const planRef = React.useRef<HTMLHeadingElement>(null);

  async function onPlan() {
    setBusy("plan");
    setError(null);
    const res = await attempt(() => previewCleanup());
    setBusy(null);
    if (!res.ok) return setError(errorText(res.error));
    setPlan(res.plan);
    setResult(null);
    requestAnimationFrame(() => planRef.current?.focus());
  }

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("run");
    setError(null);
    const res = await attempt(() => runCleanup({ confirm }));
    setBusy(null);
    if (!res.ok) return setError(errorText(res.error, "expected" in res ? res.expected : undefined));
    setResult({ result: res.result, kept: res.kept });
    setPlan(null);
    setConfirm("");
    say({ kind: "ok", text: `The clean-up ran (run ${res.result.runId}) and is in the log.` });
    refresh();
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  const n = plan?.accounts.length ?? 0;

  return (
    <section aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="text-lg font-semibold">
        Clean-up
      </h2>
      <p className="mt-1 mb-3 text-sm text-[var(--muted-foreground)]">
        Erases the marked test accounts, ends every showcase sign-in session, purges expired sessions and sign-in links, and
        deletes course files removed more than 7 days ago that nothing uses (on the live site only). Do a dry
        run first; rehearse the run on a copy of the database before running it on the live site.
      </p>
      <Card>
        <CardContent className="p-4 space-y-4">
          <Button size="sm" variant="outline" onClick={onPlan} disabled={busy !== null}>
            {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Dry run
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)] flex items-start gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden />
              {error}
            </p>
          ) : null}

          {plan ? (
            <div className="space-y-3">
              <h3 ref={planRef} tabIndex={-1} className="text-sm font-semibold outline-none">
                What a run would delete now
              </h3>
              <Counts
                rows={[
                  { label: "Marked test accounts to erase", value: plan.accounts.length },
                  ...Object.entries(plan.rows).map(([k, v]) => ({ label: `· ${ROW_LABELS[k] ?? k}`, value: v })),
                  { label: "Showcase sign-in sessions", value: plan.demoSessions },
                  { label: "Expired sessions", value: plan.expiredSessions },
                  { label: "Expired sign-in links", value: plan.expiredSignInLinks },
                  ...fileRows(plan.files, false),
                ]}
              />
              {plan.accounts.length ? (
                <details className="text-sm">
                  <summary className="cursor-pointer">The accounts to erase</summary>
                  <ul className="mt-1 list-disc pl-5 break-all">
                    {plan.accounts.map((a) => (
                      <li key={a.id}>{a.email}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {plan.kept.length ? (
                <div className="text-sm">
                  <p className="font-medium">Marked, but left by the run:</p>
                  <ul className="list-disc pl-5 break-all">
                    {plan.kept.map((a) => (
                      <li key={a.id}>
                        {a.email}: {REFUSAL_TEXT[a.reason]}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {plan.trialCourses.length ? (
                <div className="text-sm">
                  <p className="font-medium">Trial courses still live (only test accounts or staff took them):</p>
                  <ul className="list-disc pl-5">
                    {plan.trialCourses.map((c) => (
                      <li key={c.slug}>
                        {c.title} ({c.status}, {c.learners} learner{c.learners === 1 ? "" : "s"})
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Archive them on Manage courses, or tell the editors.
                  </p>
                </div>
              ) : null}

              <form onSubmit={onRun} className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
                <label className="text-xs text-[var(--muted-foreground)]">
                  <span className="block mb-1">
                    To run it, type: <strong className="text-[var(--foreground)]">ERASE {n} TEST ACCOUNTS</strong>
                  </span>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="off"
                    className={`${inputCls} w-64 max-w-full`}
                  />
                </label>
                <Button type="submit" size="sm" variant="danger" aria-disabled={busy !== null || undefined}>
                  {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                  Run the clean-up
                </Button>
              </form>
            </div>
          ) : null}

          {result ? (
            <div className="space-y-3">
              <h3 ref={resultRef} tabIndex={-1} className="text-sm font-semibold outline-none">
                Run {result.result.runId}: done
              </h3>
              <Counts
                rows={[
                  { label: "Test accounts erased", value: result.result.erased },
                  ...Object.entries(result.result.rows).map(([k, v]) => ({ label: `· ${ROW_LABELS[k] ?? k}`, value: v })),
                  { label: "Showcase sign-in sessions ended", value: result.result.demoSessions },
                  { label: "Expired sessions removed", value: result.result.expiredSessions },
                  { label: "Expired sign-in links removed", value: result.result.expiredSignInLinks },
                  ...fileRows(result.result.files, true),
                ]}
              />
              {result.result.failed.length ? (
                <div className="text-sm text-[var(--danger)]">
                  <p className="font-medium">Couldn&apos;t be erased (run again later):</p>
                  <ul className="list-disc pl-5 break-all">
                    {result.result.failed.map((a) => (
                      <li key={a.id}>{a.email}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {result.kept.length ? (
                <p className="text-sm">{result.kept.length} marked account(s) were left (see the dry run).</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

/* -------------------------------------------------------------------- log --- */

function LogViewer({ log }: { log: LogRow[] }) {
  const ids = React.useId();
  return (
    <section aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} className="text-lg font-semibold">
        Log
      </h2>
      <p className="mt-1 mb-3 text-sm text-[var(--muted-foreground)]">
        The last {log.length} data and account records: exports and erasures (by admins and by people
        themselves), resets and test marks, organisation and country changes, refused additions, guardian
        permissions, safeguarding saves and clean-up runs.
      </p>
      {log.length ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted)] text-left text-xs">
              <tr>
                <th scope="col" className="px-3 py-2">
                  When
                </th>
                <th scope="col" className="px-3 py-2">
                  Action
                </th>
                <th scope="col" className="px-3 py-2">
                  Who
                </th>
                <th scope="col" className="px-3 py-2">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-1.5">{r.action}</td>
                  <td className="px-3 py-1.5 break-all">{r.who ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">Nothing yet.</p>
      )}
    </section>
  );
}
