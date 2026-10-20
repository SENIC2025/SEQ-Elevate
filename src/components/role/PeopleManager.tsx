"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import {
  addMember,
  setMemberRoles,
  assignCohort,
  removeMember,
  resendInvitation,
} from "@/app/actions/admin";
import type { AdminMember } from "@/lib/admin-queries";
import type { InviteOutcome } from "@/lib/invitations";
import { includedVia, roleIncludes } from "@/lib/permissions";
import type { Role } from "@prisma/client";
import {
  UserPlus,
  Trash2,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  Send,
} from "lucide-react";

const ROLES: { value: Role; label: string }[] = [
  { value: "LEARNER", label: "Learner" },
  { value: "FACILITATOR", label: "Facilitator" },
  { value: "CONTENT_EDITOR", label: "Editor" },
  { value: "ADMIN", label: "Admin" },
];

const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r;

/** The other roles a role brings with it, e.g. ["Editor"] for Admin. */
const includedLabels = (r: Role) =>
  ROLES.filter((x) => x.value !== r && roleIncludes(r, x.value)).map(
    (x) => x.label
  );

const INVITE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "el", label: "Ελληνικά" },
];

const inputCls =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

type Notice = { kind: "ok" | "warn"; text: string };

/** What a refused change means, in plain words. */
function errorText(error?: string): string {
  switch (error) {
    case "forbidden":
      return "Admins only.";
    case "bad-email":
      return "That doesn't look like a valid email.";
    case "no-roles":
      return "Everyone needs at least one role.";
    case "self":
      return "You can't remove yourself. Another admin can.";
    case "own-admin":
      return "You can't switch off your own Admin role. Another admin can.";
    default:
      return "Something went wrong.";
  }
}

/** Plain-language feedback for what happened to an invitation. */
function inviteNotice(
  email: string,
  outcome: InviteOutcome,
  adding: boolean,
  reason?: string
): Notice {
  const added = adding ? `Added ${email}` : null;
  switch (outcome) {
    case "sent":
      return {
        kind: "ok",
        text: adding
          ? `${added} and sent them an invitation email.`
          : `Invitation sent to ${email}.`,
      };
    case "already-joined":
      return {
        kind: "ok",
        text: `${added ?? email}. They already have an account, so no invitation was needed — they'll see their new workspace next time they open SEQ Elevate.`,
      };
    case "not-requested":
      return {
        kind: "ok",
        text: `${added}. No invitation was sent — you can send one from the list below.`,
      };
    case "rate-limited":
      return {
        kind: "warn",
        text: `${added ? `${added}, but t` : "T"}oo many invitations were sent to this address recently. Please try again in an hour.`,
      };
    default:
      return {
        kind: "warn",
        text:
          `${added ? `${added}, but the` : "The"} invitation email couldn't be sent.` +
          (reason ? ` The email service said: "${reason.replace(/\.$/, "")}".` : "") +
          " You can try again from the list below.",
      };
  }
}

export function PeopleManager({
  members,
  cohorts,
  selfId,
}: {
  members: AdminMember[];
  cohorts: { id: string; label: string }[];
  /** The signed-in admin: their own Admin role and row can't be removed here. */
  selfId: string | null;
}) {
  const router = useRouter();
  const uiLocale = useLocale();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("LEARNER");
  const [invite, setInvite] = React.useState(true);
  const [inviteLang, setInviteLang] = React.useState(uiLocale);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const roleHintId = React.useId();
  const ids = React.useId();
  const binId = (id: string) => `${ids}-rm-${id}`;
  const selfHintId = `${ids}-self`;
  // The person whose removal is being asked about, and why it failed.
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  // Where focus goes once the list has changed (the counter repeats a move).
  const [focus, setFocus] = React.useState<{ id: string; n: number } | null>(null);
  const focusEl = (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  React.useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);
  // The list the last change returned, shown until the page's own list
  // (`members`) is rendered again: the refresh after a change sometimes
  // doesn't show until the next router update (see actions/admin.ts).
  const [fresh, setFresh] = React.useState<{
    from: AdminMember[];
    list: AdminMember[];
  } | null>(null);
  const shown = fresh && fresh.from === members ? fresh.list : members;
  const selectedIncludes = includedLabels(role);

  function report(res: {
    ok: boolean;
    error?: string;
    members?: AdminMember[] | null;
  }) {
    if (res.ok) {
      if (res.members) setFresh({ from: members, list: res.members });
      setError(null);
      router.refresh();
    } else {
      setError(errorText(res.error));
    }
    setPending(null);
  }

  async function onAdd() {
    if (!email.trim()) return;
    setPending("add");
    setNotice(null);
    const address = email.trim().toLowerCase();
    const res = await addMember(email, role, name, {
      invite,
      locale: inviteLang,
    });
    if (res.ok) {
      setEmail("");
      setName("");
      setNotice(inviteNotice(address, res.invite, true, res.inviteReason));
    }
    report(res);
  }

  async function onResend(m: AdminMember) {
    setPending(`inv-${m.id}`);
    setNotice(null);
    const res = await resendInvitation(m.id, inviteLang);
    if (res.ok) {
      setNotice(inviteNotice(m.email, "sent", false));
      report(res);
    } else if (res.error === "forbidden") {
      report(res);
    } else {
      setNotice(
        inviteNotice(
          m.email,
          res.error as InviteOutcome,
          false,
          "reason" in res ? res.reason : undefined
        )
      );
      setPending(null);
      router.refresh();
    }
  }

  async function toggleRole(m: AdminMember, r: Role) {
    if (m.id === selfId && r === "ADMIN") {
      setError(errorText("own-admin"));
      return;
    }
    const next = m.roles.includes(r)
      ? m.roles.filter((x) => x !== r)
      : [...m.roles, r];
    if (next.length === 0) {
      setError("Everyone needs at least one role.");
      return;
    }
    setPending(`roles-${m.id}`);
    report(await setMemberRoles(m.id, next));
  }

  /** The bin asks first; on your own row it says why it can't. */
  function askRemove(m: AdminMember) {
    if (m.id === selfId) {
      setError(errorText("self"));
      return;
    }
    setError(null);
    setConfirmError(null);
    setConfirming(m.id);
  }

  function keep(m: AdminMember) {
    setConfirming(null);
    setConfirmError(null);
    focusEl(binId(m.id));
  }

  async function onRemove(m: AdminMember) {
    setPending(`rm-${m.id}`);
    setConfirmError(null);
    setNotice(null);
    // The person after them in the list (or before, at the end) takes
    // focus once they've gone; the Email field when nobody is left.
    const at = shown.findIndex((x) => x.id === m.id);
    const near = shown[at + 1] ?? shown[at - 1];
    const res = await removeMember(m.id);
    if (!res.ok) {
      setConfirmError(errorText(res.error));
      setPending(null);
      return;
    }
    setConfirming(null);
    setNotice({
      kind: "ok",
      text: `Removed ${m.email} from the project. Their account and data stay.`,
    });
    report(res);
    focusEl(near && near.id !== m.id ? binId(near.id) : `${ids}-email`);
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="text-sm text-[var(--danger)] flex items-center gap-1.5" role="alert">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </p>
      ) : null}

      {/* Polite live region: announces invitation results without stealing focus. */}
      <div role="status" aria-live="polite">
        {notice ? (
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
        ) : null}
      </div>

      {/* Add someone */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <UserPlus className="h-4 w-4 text-[var(--accent)]" />
            Add someone to the project
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Email</span>
              <input
                id={`${ids}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.org"
                className={`${inputCls} w-60`}
              />
            </label>
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${inputCls} w-44`}
              />
            </label>
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Role</span>
              {/* Explicit aria-label: a wrapping <label> would fold the
                  selected option text into the accessible name. */}
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                aria-label="Role"
                aria-describedby={selectedIncludes.length ? roleHintId : undefined}
                className={inputCls}
              >
                {ROLES.map((r) => {
                  const extra = includedLabels(r.value);
                  return (
                    <option key={r.value} value={r.value}>
                      {extra.length
                        ? `${r.label} (includes ${extra.join(", ")})`
                        : r.label}
                    </option>
                  );
                })}
              </select>
            </label>
            <Button
              size="sm"
              onClick={onAdd}
              disabled={!email.trim() || pending === "add"}
            >
              {pending === "add" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Add
            </Button>
          </div>
          {selectedIncludes.length ? (
            <p
              id={roleHintId}
              className="mt-2 text-xs text-[var(--muted-foreground)] flex items-start gap-1.5"
            >
              <Info className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0 mt-0.5" />
              {roleLabel(role)} includes {selectedIncludes.join(", ")}, so
              there&apos;s no need to add {selectedIncludes.join(", ")}{" "}
              separately.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={invite}
                onChange={(e) => setInvite(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Send them an invitation email
            </label>
            {invite ? (
              <label className="inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span>in</span>
                <select
                  value={inviteLang}
                  onChange={(e) => setInviteLang(e.target.value)}
                  aria-label="Invitation language"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)]"
                >
                  {INVITE_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0 mt-0.5" />
            The invitation has a one-click link to join (valid 7 days) and
            says which role they have. Sign-in is passwordless — they can also
            just go to the sign-in page and enter this email. No password is
            ever set here.
          </p>
        </CardContent>
      </Card>

      {/* People */}
      <Card>
        {/* relative: the table's visually hidden headings are positioned,
            and would otherwise escape this scroll box and widen the page. */}
        <CardContent className="relative p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Roles</th>
                <th className="px-3 py-2.5 font-medium">Cohort</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Added</th>
                <th className="px-3 py-2.5 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-sm text-[var(--muted-foreground)]"
                  >
                    Nobody in the project yet.
                  </td>
                </tr>
              ) : (
                shown.map((m) => (
                  <React.Fragment key={m.id}>
                    <tr
                      className={`border-b border-[var(--border)] ${
                        confirming === m.id ? "" : "last:border-0"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        {m.name ? (
                          <div className="font-medium">{m.name}</div>
                        ) : null}
                        <div className="text-[11px] text-[var(--muted-foreground)] break-all">
                          {m.email}
                        </div>
                        {m.id === selfId ? (
                          <p
                            id={selfHintId}
                            className="mt-1 max-w-56 text-[11px] text-[var(--muted-foreground)]"
                          >
                            This is you. You can&apos;t switch off your own Admin
                            role or remove yourself. Another admin can.
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {/* py-1: at least 24px high (WCAG 2.5.8), as the
                            chips wrap onto two lines in a narrow column. */}
                        <div className="flex flex-wrap gap-1">
                          {ROLES.map((r) => {
                            // Held through another role (Admin includes
                            // Editor): shown as on, but not separately
                            // switchable while that role is held.
                            const via = includedVia(m.roles, r.value);
                            if (via) {
                              return (
                                <button
                                  key={r.value}
                                  type="button"
                                  disabled
                                  aria-pressed
                                  className="rounded-full border border-dashed border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-1 text-[11px] text-[var(--accent)] cursor-default"
                                >
                                  <span className="font-medium">{r.label}</span>
                                  <span aria-hidden="true"> ·</span> included
                                  with {roleLabel(via)}
                                </button>
                              );
                            }
                            const on = m.roles.includes(r.value);
                            // Your own Admin role stays on: focusable, so it
                            // can say why (the line under your email).
                            const locked =
                              on && r.value === "ADMIN" && m.id === selfId;
                            return (
                              <button
                                key={r.value}
                                type="button"
                                onClick={() => toggleRole(m, r.value)}
                                disabled={pending === `roles-${m.id}`}
                                aria-pressed={on}
                                aria-disabled={locked || undefined}
                                aria-describedby={locked ? selfHintId : undefined}
                                className={`rounded-full border px-2 py-1 text-[11px] ${
                                  on
                                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)]"
                                }${locked ? " cursor-not-allowed" : ""}`}
                              >
                                {r.label}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={m.cohortId ?? ""}
                          onChange={async (e) => {
                            setPending(`cohort-${m.id}`);
                            report(
                              await assignCohort(m.id, e.target.value || null)
                            );
                          }}
                          disabled={pending === `cohort-${m.id}`}
                          aria-label={`Cohort for ${m.email}`}
                          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                        >
                          <option value="">— none —</option>
                          {cohorts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        {m.status === "joined" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--foreground)]">
                            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden />
                            Joined
                          </span>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                              <Clock className="h-3.5 w-3.5" aria-hidden />
                              {m.invitedAt
                                ? `Invited ${m.invitedAt}`
                                : "Not joined yet"}
                            </span>
                            <button
                              type="button"
                              onClick={() => onResend(m)}
                              disabled={pending === `inv-${m.id}`}
                              aria-label={`${m.invitedAt ? "Resend invitation" : "Send invitation"} to ${m.email}`}
                              className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
                            >
                              {pending === `inv-${m.id}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                              ) : (
                                <Send className="h-3 w-3" aria-hidden />
                              )}
                              {m.invitedAt ? "Resend invitation" : "Send invitation"}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--muted-foreground)] tabular-nums">
                        {m.joinedAt}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          id={binId(m.id)}
                          type="button"
                          onClick={() => askRemove(m)}
                          aria-label={`Remove ${m.email} from the project`}
                          aria-disabled={m.id === selfId || undefined}
                          aria-describedby={m.id === selfId ? selfHintId : undefined}
                          className={
                            m.id === selfId
                              ? "rounded-md p-1 text-[var(--muted-foreground)] opacity-50 cursor-not-allowed"
                              : "rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                    {confirming === m.id ? (
                      <tr className="border-b border-[var(--border)] last:border-0">
                        <td colSpan={6} className="px-4 pb-3">
                          <InlineConfirm
                            heading="h2"
                            title={`Remove ${m.name || m.email} from the project?`}
                            confirmLabel="Remove from project"
                            keepLabel="Keep them"
                            busy={pending === `rm-${m.id}`}
                            error={confirmError}
                            onConfirm={() => onRemove(m)}
                            onKeep={() => keep(m)}
                          >
                            <p className="mt-1 text-xs">
                              They lose their roles and their cohort, and leave
                              this list. Their account and data stay: progress,
                              Comp Card and notes about them are kept. They can
                              still sign in, as a learner.
                            </p>
                          </InlineConfirm>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
