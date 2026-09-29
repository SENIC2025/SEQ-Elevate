"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  addMember,
  setMemberRoles,
  assignCohort,
  removeMember,
  resendInvitation,
} from "@/app/actions/admin";
import type { AdminMember } from "@/lib/admin-queries";
import type { InviteOutcome } from "@/lib/invitations";
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

const INVITE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "el", label: "Ελληνικά" },
];

const inputCls =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

type Notice = { kind: "ok" | "warn"; text: string };

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
}: {
  members: AdminMember[];
  cohorts: { id: string; label: string }[];
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

  function report(res: { ok: boolean; error?: string }) {
    if (res.ok) {
      setError(null);
      router.refresh();
    } else {
      setError(
        res.error === "forbidden"
          ? "Admins only."
          : res.error === "bad-email"
            ? "That doesn't look like a valid email."
            : res.error === "no-roles"
              ? "Everyone needs at least one role."
              : res.error === "self"
                ? "You can't remove yourself."
                : "Something went wrong."
      );
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
                className={inputCls}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
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
        <CardContent className="p-0 overflow-x-auto">
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
              {members.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-sm text-[var(--muted-foreground)]"
                  >
                    Nobody in the project yet.
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      {m.name ? (
                        <div className="font-medium">{m.name}</div>
                      ) : null}
                      <div className="text-[11px] text-[var(--muted-foreground)] break-all">
                        {m.email}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {ROLES.map((r) => {
                          const on = m.roles.includes(r.value);
                          return (
                            <button
                              key={r.value}
                              type="button"
                              onClick={() => toggleRole(m, r.value)}
                              disabled={pending === `roles-${m.id}`}
                              aria-pressed={on}
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                on
                                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)]"
                              }`}
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
                        type="button"
                        onClick={async () => {
                          setPending(`rm-${m.id}`);
                          report(await removeMember(m.id));
                        }}
                        aria-label={`Remove ${m.email} from the project`}
                        className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
