"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  addMember,
  setMemberRoles,
  assignCohort,
  removeMember,
} from "@/app/actions/admin";
import type { AdminMember } from "@/lib/admin-queries";
import type { Role } from "@prisma/client";
import {
  UserPlus,
  Trash2,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react";

const ROLES: { value: Role; label: string }[] = [
  { value: "LEARNER", label: "Learner" },
  { value: "FACILITATOR", label: "Facilitator" },
  { value: "CONTENT_EDITOR", label: "Editor" },
  { value: "ADMIN", label: "Admin" },
];

const inputCls =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

export function PeopleManager({
  members,
  cohorts,
}: {
  members: AdminMember[];
  cohorts: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("LEARNER");
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
    const res = await addMember(email, role, name);
    if (res.ok) {
      setEmail("");
      setName("");
    }
    report(res);
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
          <p className="mt-2 text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0 mt-0.5" />
            Sign-in is passwordless — they simply go to the sign-in page and
            enter this email to receive a one-click link. No password is ever
            set here.
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
                <th className="px-3 py-2.5 font-medium">Joined</th>
                <th className="px-3 py-2.5 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
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
