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
  CleanupAccount,
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
 *
 * Focus never falls to the page's start: a control that is busy says so
 * with aria-disabled (it stays focusable), and once something closes or is
 * gone, focus goes to what is nearby (the person's actions, the search
 * field, the list's heading).
 */

const inputCls = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
/** A button that is busy or has nothing to act on looks it, and stays focusable. */
const ariaDisabledCls = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const REF_PATTERN = "REQ-[0-9]{4}-[0-9]{3}";
const FIND_MIN = 3;

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
      return `Type at least ${FIND_MIN} characters of the address.`;
    case "not-found":
      return "That account no longer exists.";
    case "signed-out":
      return "You are signed out. Sign in again, then try once more.";
    case "export-refused":
      return "Refused: only an admin with a completed profile can export, from this page. Reload the page and try again.";
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

/** Roles as Manage people names them. */
const ROLE_LABELS: Record<string, string> = {
  LEARNER: "Learner",
  FACILITATOR: "Facilitator",
  CONTENT_EDITOR: "Editor",
  PARTNER_ADMIN: "Partner admin",
  ADMIN: "Admin",
};
const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;
const holdsStaffRole = (a: CleanupAccount) => a.roles.some((r) => r !== "LEARNER");

/** The logged actions, in words (the code stays as secondary text). */
const ACTION_LABELS: Record<string, string> = {
  "account.exported": "Data exported",
  "account.deleted": "Account erased",
  "account.reset": "Test account reset",
  "account.test_marked": "Marked as a test account",
  "account.test_unmarked": "Test account mark removed",
  "data.cleanup_run": "Clean-up run",
  "person.organisation_changed": "Organisation changed",
  "person.country_changed": "Country changed",
  "person.name_changed": "Name changed",
  "profile.organisation_released": "Organisation released by the country rule",
  "member.add_refused": "Addition refused on Manage people",
  "member.guardian_consent_recorded": "Guardian's permission recorded",
  "safeguarding.saved": "Safeguarding contacts saved",
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
    desc: "People who hold or held a staff role and played courses. Statistics already leave staff out, so mark only the accounts that are tests: the clean-up run erases every marked account, with its roles.",
  },
  {
    key: "member-targets",
    title: () => "Changed on People, never staff",
    desc: "Accounts added or changed on Manage people with no record of a staff role.",
  },
  {
    key: "partner-never-signed-in",
    title: () => "Added by a partner admin, never signed in",
    desc: "With the organisation and the date they were added.",
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
      <span className="min-w-0 break-words">{notice.text}</span>
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

type Changed = (n: Notice, after?: { gone?: boolean }) => Promise<void>;

function FindPerson({ say, refresh }: { say: (n: Notice | null) => void; refresh: () => void }) {
  const ids = React.useId();
  const [query, setQuery] = React.useState("");
  const [people, setPeople] = React.useState<FoundPerson[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const last = React.useRef("");
  const field = React.useRef<HTMLInputElement>(null);

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

  /**
   * After a change: the list again, and the page's lists and log. When the
   * person is gone (erased), focus goes to the search field: what they acted
   * on no longer exists.
   */
  const changed: Changed = async (n, after) => {
    say(n);
    if (after?.gone) field.current?.focus();
    refresh();
    if (last.current) await search(last.current);
  };

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
              if (busy) return;
              // Too short: said here, so Find and Enter always answer.
              if (query.trim().length < FIND_MIN) return setError(errorText("too-short"));
              void search(query);
            }}
          >
            <label className="w-full min-w-0 text-xs text-[var(--muted-foreground)] sm:w-auto">
              <span className="block mb-1">Email address (or part of it)</span>
              <input
                ref={field}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-describedby={`${ids}-hint`}
                className={`${inputCls} w-full sm:w-72`}
                autoComplete="off"
              />
            </label>
            {/* aria-disabled, not disabled, while it searches: focus stays on it. */}
            <Button type="submit" size="sm" className={ariaDisabledCls} aria-disabled={busy || undefined}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              Find
            </Button>
            <p id={`${ids}-hint`} className="w-full text-xs text-[var(--muted-foreground)]">
              {`At least ${FIND_MIN} characters.`}
            </p>
          </form>
          <p className="text-xs text-[var(--muted-foreground)]">
            Anyone with an account, member or not: people removed from the project and accounts that never
            finished the profile step too.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)] flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
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

/** The export route's refusals, by status, in plain words. */
const EXPORT_REFUSALS: Record<number, string> = {
  400: "request-ref",
  401: "signed-out",
  403: "export-refused",
  404: "not-found",
};

/** Saves `blob` as a download called `name`. */
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function PersonActions({ person: p, onChanged }: { person: FoundPerson; onChanged: Changed }) {
  const ids = React.useId();
  const [open, setOpen] = React.useState<"export" | "reset" | "erase" | null>(null);
  // What opens takes focus: the reference to type, or the question to read
  // (the reset's InlineConfirm focuses its own heading).
  const refInput = React.useRef<HTMLInputElement>(null);
  const eraseHeading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    if (open === "export") refInput.current?.focus();
    if (open === "erase") eraseHeading.current?.focus();
  }, [open]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = React.useState("");
  const [ref, setRef] = React.useState("");

  /** Closes what is open; focus goes back to the person's actions. */
  const close = () => {
    setOpen(null);
    setError(null);
    setConfirmEmail("");
    setRef("");
    document.getElementById(`${ids}-actions`)?.focus();
  };

  async function onMark() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await attempt(() => markTestAccount(p.id, !p.testAccount));
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    await onChanged({ kind: "ok", text: `${p.email} is ${res.testAccount ? "now marked" : "no longer marked"} as a test account.` });
  }

  /**
   * Posts the export from this page (the browser sends the page's Origin,
   * which the route requires) and saves the answer as a file; a refusal is
   * said here, and the page stays. The logged export then shows in the log.
   */
  async function onExport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const requestRef = String(new FormData(e.currentTarget).get("requestRef") ?? "").trim();
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/admin/people/${encodeURIComponent(p.id)}/export`, {
        method: "POST",
        body: new URLSearchParams({ requestRef }),
      });
      if (res.ok) {
        const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
        saveFile(await res.blob(), name ?? `seq-elevate-data-${requestRef}.json`);
      }
    } catch {
      setBusy(false);
      return setError(errorText("no-answer"));
    }
    setBusy(false);
    if (!res.ok) return setError(errorText(EXPORT_REFUSALS[res.status]));
    await onChanged({ kind: "ok", text: `Downloaded the data of ${p.email} (${requestRef}). The export is in the log.` });
  }

  async function onReset() {
    setBusy(true);
    setError(null);
    const res = await attempt(() => resetTestAccount(p.id));
    setBusy(false);
    if (!res.ok) return setError(errorText(res.error));
    close();
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
    await onChanged({ kind: "ok", text: `Erased ${p.email}. The log keeps a record without the address.` }, { gone: true });
  }

  const facts = [
    p.roles.length ? p.roles.map(roleLabel).join(", ") : "no role",
    p.organisation ?? "no organisation",
    `${p.enrolments} course${p.enrolments === 1 ? "" : "s"}${p.compCard ? ", a Comp Card" : ""}`,
  ];

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="font-medium break-all">{p.email}</p>
      <p className="mt-0.5 text-xs text-[var(--muted-foreground)] break-words">
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
        {/* aria-disabled, not disabled, while it saves: focus stays on it. */}
        <Button size="sm" variant="outline" className={ariaDisabledCls} onClick={onMark} aria-disabled={busy || undefined}>
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
      ) : p.testAccount ? null : (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Reset is for marked test accounts: mark the account first to reset it.
        </p>
      )}
      {error && open === null ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {open === "export" ? (
        <form
          onSubmit={onExport}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] p-3"
        >
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Request reference (REQ-YYYY-NNN)</span>
            <input
              ref={refInput}
              name="requestRef"
              required
              pattern={REF_PATTERN}
              placeholder="REQ-2026-001"
              className={`${inputCls} w-44`}
            />
          </label>
          <Button type="submit" size="sm" className={ariaDisabledCls} aria-disabled={busy || undefined}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Download their data
          </Button>
          <p className="w-full text-xs text-[var(--muted-foreground)]">
            The file holds everything about them, their Comp Card and reflections included. The download is
            logged with the reference.
          </p>
          {error ? (
            <p role="alert" className="flex w-full items-start gap-1.5 text-xs text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {open === "reset" ? (
        <div className="mt-3">
          <InlineConfirm
            title={<span className="break-words">Reset {p.email}?</span>}
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
          <h3 id={`${ids}-erase`} ref={eraseHeading} tabIndex={-1} className="text-sm font-semibold outline-none break-words">
            Erase {p.email} for good?
          </h3>
          <p className="text-xs">
            The account and everything linked to it are deleted, with their activity records, sign-in links
            and rate-limit counters. Notes they wrote stay, unsigned. The log keeps one record, with the
            reference and without the address.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-full min-w-0 text-xs text-[var(--muted-foreground)] sm:w-auto">
              <span className="block mb-1">Type their address to confirm</span>
              <input
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="off"
                className={`${inputCls} w-full sm:w-64`}
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
  const heading = React.useRef<HTMLHeadingElement>(null);
  const [ticked, setTicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const unmarked = people.filter((p) => !p.testAccount);

  /** Marks `list`; the marked become chips, so focus goes to the list's heading. */
  async function mark(list: string[]) {
    if (busy || list.length === 0) return;
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
    heading.current?.focus();
    refresh();
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">
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
                    // Named by its visible words first, then whose (WCAG 2.5.3).
                    <Button
                      size="sm"
                      variant="ghost"
                      className={`ml-auto ${ariaDisabledCls}`}
                      aria-disabled={busy || undefined}
                      onClick={() => mark([p.id])}
                      aria-label={`Mark as test account: ${p.email}`}
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
                className={`mt-2 ${ariaDisabledCls}`}
                aria-disabled={busy || ticked.size === 0 || undefined}
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

/** An account the run erases, with its roles; a staff role is said in words. */
function AccountLine({ account: a }: { account: CleanupAccount }) {
  return (
    <li>
      <span className="break-all">{a.email}</span>
      {" · "}
      {a.roles.length ? a.roles.map(roleLabel).join(", ") : "no role"}
      {holdsStaffRole(a) ? <strong className="font-semibold"> (holds a staff role)</strong> : null}
    </li>
  );
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
    if (busy) return;
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
  const staff = plan?.accounts.filter(holdsStaffRole).length ?? 0;

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
          {/* aria-disabled, not disabled, while it works: focus stays on it. */}
          <Button size="sm" variant="outline" className={ariaDisabledCls} onClick={onPlan} aria-disabled={busy !== null || undefined}>
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
                // Open from the start when a staff account is among them.
                <details className="text-sm" open={staff > 0}>
                  <summary className="cursor-pointer">The accounts to erase, with their roles</summary>
                  <ul className="mt-1 list-disc pl-5" aria-label="The accounts to erase">
                    {plan.accounts.map((a) => (
                      <AccountLine key={a.id} account={a} />
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
                {staff > 0 ? (
                  <p className="flex w-full items-start gap-1.5 text-sm text-[var(--danger)]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                    <span className="min-w-0">
                      {staff === 1 ? "1 of them holds a staff role" : `${staff} of them hold a staff role`}: the run
                      erases the account with its roles. Unmark any that isn&apos;t a test account before you run it.
                    </span>
                  </p>
                ) : null}
                <label className="w-full min-w-0 text-xs text-[var(--muted-foreground)] sm:w-auto">
                  <span className="block mb-1">
                    To run it, type: <strong className="text-[var(--foreground)]">ERASE {n} TEST ACCOUNTS</strong>
                  </span>
                  <input
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="off"
                    className={`${inputCls} w-full sm:w-64`}
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
                  When (Brussels time)
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
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{r.when}</td>
                  <td className="px-3 py-1.5">
                    {ACTION_LABELS[r.action] ?? r.action}
                    {ACTION_LABELS[r.action] ? (
                      <span className="block text-xs text-[var(--muted-foreground)]">{r.action}</span>
                    ) : null}
                  </td>
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
