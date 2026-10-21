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
  updatePersonProfile,
  setGuardianSharing,
} from "@/app/actions/admin";
import type { AdminMember } from "@/lib/admin-queries";
import type { InviteOutcome } from "@/lib/invitations";
import { includedVia, roleIncludes } from "@/lib/permissions";
import { COUNTRIES, type Country } from "@/lib/countries";
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
  Pencil,
} from "lucide-react";

/*
 * Manage people (spec 6.3). English, as the other staff screens. An ADMIN
 * sees everyone and may grant every role, pick anyone's organisation and
 * change their country; a partner admin sees its own organisation's people,
 * offers only the roles it may grant (LEARNER, FACILITATOR), and changes
 * only people who hold nothing else. The server refuses the rest anyway
 * (actions/admin.ts); the screen just doesn't offer it.
 */

/** Every role, in the order the screen shows them. */
const ROLES: { value: Role; label: string }[] = [
  { value: "LEARNER", label: "Learner" },
  { value: "FACILITATOR", label: "Facilitator" },
  { value: "CONTENT_EDITOR", label: "Editor" },
  { value: "PARTNER_ADMIN", label: "Partner admin" },
  { value: "ADMIN", label: "Admin" },
];

const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r;

/** The other roles a role brings with it, e.g. ["Editor"] for Admin. */
const includedLabels = (r: Role) =>
  ROLES.filter((x) => x.value !== r && roleIncludes(r, x.value)).map(
    (x) => x.label
  );

const COUNTRY_NAMES: Record<Country, string> = {
  DE: "Germany",
  CY: "Cyprus",
  BE: "Belgium",
  GR: "Greece",
  OTHER: "Other country",
};

const INVITE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "el", label: "Ελληνικά" },
];

/**
 * The lists an ADMIN can show (spec 6.3): the project's people (those with
 * a role), and for review, people with no role (removed, or who never
 * finished signing up) and three lists of everyone.
 */
type Filter = "all" | "no-role" | "no-organisation" | "mismatch" | "partner-pending";
const FILTERS: { value: Filter; label: string; keep: (m: AdminMember) => boolean }[] = [
  { value: "all", label: "People with a role", keep: (m) => m.roles.length > 0 },
  { value: "no-role", label: "No role: removed, or never finished signing up", keep: (m) => m.roles.length === 0 },
  { value: "no-organisation", label: "No organisation", keep: (m) => !m.organisationId },
  { value: "mismatch", label: "Country doesn't match organisation", keep: (m) => m.countryMismatch },
  {
    value: "partner-pending",
    label: "Added by a partner admin, never signed in",
    keep: (m) => m.organisationSource === "partner-admin" && m.status === "pending",
  },
];

const inputCls =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
const chipCls =
  "inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]";

type Notice = { kind: "ok" | "warn"; text: string };

/** What a refused change means, in plain words. */
function errorText(error?: string): string {
  switch (error) {
    case "forbidden":
      return "You don't have permission to do that.";
    case "bad-email":
      return "That doesn't look like a valid email.";
    case "bad-role":
    case "not-grantable":
      return "Only an admin gives or changes that role, or changes this person. Ask DIESIS.";
    case "bad-name":
      return "Use a name of 1 to 50 characters, on one line.";
    case "bad-country":
      return "Choose a country.";
    case "no-roles":
      return "Everyone needs at least one role.";
    case "self":
      return "You can't remove yourself. Another admin can.";
    case "own-admin":
      return "You can't switch off your own Admin role. Another admin can.";
    case "out-of-scope":
      return "This address can't be added from here. Ask DIESIS.";
    case "has-organisation":
      return "They already belong to an organisation. To move them, use “Change details” on their row.";
    case "guardian-learner-only":
      return "A guardian's permission is recorded for learners only.";
    case "guardian-not-needed":
      return "They have already confirmed their age themselves, so no guardian's permission is needed.";
    case "no-guardian-consent":
      return "No guardian's permission was recorded for them.";
    case "not-learner":
      return "This is for learners only.";
    case "cohort-other-organisation":
      return "Choose a cohort of their own organisation.";
    case "not-found":
    case "unknown-org":
    case "unknown-cohort":
      return "That isn't on your list any more. Reload the page.";
    case "rate-limited":
      return "Too many addresses couldn't be added in the last hour. Try again later.";
    case "changed":
      return "Someone changed this person meanwhile. Reload the page and try again.";
    case "no-answer":
      return "There was no answer from the server. Reload the page to see whether it was done.";
    default:
      return "Something went wrong.";
  }
}

/** The same, for adding someone (your own address means something else there). */
const addErrorText = (error?: string) =>
  error === "self" ? "You can't add your own address. Another admin can." : errorText(error);

/** Holds LEARNER and nothing else (or no role): their organisation follows a new country. */
const learnerOnly = (m: AdminMember) => m.roles.every((r) => r === "LEARNER");

/** What "Change details" holds while it is open. */
export interface DetailsDraft {
  name: string;
  country: string;
  organisationId: string;
}

/**
 * The draft with a new country (spec 6.3, Q24). A learner's organisation
 * follows it: the one the country is mapped to (none when it isn't), or
 * their own when their own country is picked again, shown at once so that
 * what is saved is what the form shows; another one can still be picked
 * after it. A staff member's organisation never follows a country.
 */
export function draftWithCountry(
  m: AdminMember,
  draft: DetailsDraft,
  country: string,
  mappings: Partial<Record<Country, string>>
): DetailsDraft {
  if (!learnerOnly(m)) return { ...draft, country };
  const own = country === (m.country ?? "");
  return {
    ...draft,
    country,
    organisationId: own ? (m.organisationId ?? "") : (mappings[country as Country] ?? ""),
  };
}

/**
 * What "Change details" sends: what changed, and for a learner with a new
 * country the organisation the form shows, even their own ("new country,
 * same organisation"). The country and the organisation only for an ADMIN,
 * never on their own row (the server refuses them anyway).
 */
export function detailChanges(
  m: AdminMember,
  draft: DetailsDraft,
  who: { admin: boolean; self: boolean }
): { name?: string; country?: string; organisationId?: string | null } {
  const changes: { name?: string; country?: string; organisationId?: string | null } = {};
  if (draft.name.trim() !== (m.name ?? "")) changes.name = draft.name;
  if (who.admin && !who.self) {
    const newCountry = !!draft.country && draft.country !== (m.country ?? "");
    if (newCountry) changes.country = draft.country;
    if (draft.organisationId !== (m.organisationId ?? "") || (newCountry && learnerOnly(m))) {
      changes.organisationId = draft.organisationId || null;
    }
  }
  return changes;
}

/**
 * What "Remove" does, as the question says it. Admins named in the server
 * setting (ADMIN_EMAILS) get their roles back; a partner admin never sees
 * or removes one, so it isn't told about them.
 */
export function removeNote(admin: boolean): string {
  return (
    "They lose their roles and their cohort. Their account and data stay: " +
    "progress, Comp Card, notes about them and their organisation are kept. " +
    "They aren't signed out: on their next page they're back on this list as a learner" +
    (admin ? ", or with Admin and Editor if they are named in the server setting." : ".")
  );
}

/** "Under 16", or the minimum age by country when the countries' differ (guardianAge). */
const underAge = (minAge: number | null, inTheirCountry: boolean) =>
  minAge !== null ? `Under ${minAge}` : `Under the minimum age${inTheirCountry ? " in their country" : ""}`;

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

export interface PeopleManagerProps {
  members: AdminMember[];
  /** The cohorts in scope, each with its organisation: a person only joins one of their own. */
  cohorts: { id: string; label: string; organisationId: string }[];
  /** The signed-in manager: their own roles and row can't be removed here. */
  selfId: string | null;
  /** The roles the manager may grant (grantableRoles): the only ones offered. */
  grantable: readonly Role[];
  /** An ADMIN: picks organisations, changes countries, sees the review lists. */
  admin: boolean;
  /** The organisations an ADMIN picks from. */
  organisations: { id: string; name: string }[];
  /** A partner admin's own organisation: everyone it adds joins it. */
  ownOrganisation: { id: string; name: string } | null;
  /** An ADMIN's country mapping (country → organisation id): what a learner's new country brings. */
  mappings?: Partial<Record<Country, string>>;
  /**
   * The age a guardian's permission is recorded under (guardianAge), or
   * null when the learners' countries have different ones.
   */
  minAge: number | null;
}

export function PeopleManager({
  members,
  cohorts,
  selfId,
  grantable,
  admin,
  organisations,
  ownOrganisation,
  mappings = {},
  minAge,
}: PeopleManagerProps) {
  const router = useRouter();
  const uiLocale = useLocale();
  const offered = ROLES.filter((r) => grantable.includes(r.value));
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("LEARNER");
  const [organisationId, setOrganisationId] = React.useState("");
  const [guardian, setGuardian] = React.useState(false);
  const [guardianSharing, setGuardianSharingTick] = React.useState(false);
  const [invite, setInvite] = React.useState(true);
  const [inviteLang, setInviteLang] = React.useState(uiLocale);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const roleHintId = React.useId();
  const ids = React.useId();
  const binId = (id: string) => `${ids}-rm-${id}`;
  const editId = (id: string) => `${ids}-ed-${id}`;
  const selfHintId = `${ids}-self`;
  const lockedHintId = (id: string) => `${ids}-locked-${id}`;
  // The person whose removal is being asked about, and why it failed.
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  // The person whose details are being changed, the draft, and why it failed.
  const [editing, setEditing] = React.useState<({ id: string } & DetailsDraft) | null>(null);
  const [editError, setEditError] = React.useState<string | null>(null);
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
  const current = fresh && fresh.from === members ? fresh.list : members;
  const shown = current.filter(FILTERS.find((f) => f.value === filter)!.keep);
  const selectedIncludes = includedLabels(role);

  /** May the manager change this person (their roles, cohort, name; remove them)? */
  const canChange = (m: AdminMember) => m.roles.every((r) => grantable.includes(r));

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
    const learner = role === "LEARNER";
    const res = await addMember(email, role, name, {
      invite,
      locale: inviteLang,
      ...(admin ? { organisationId: organisationId || null } : {}),
      guardianConsent: learner && guardian,
      guardianSharing: learner && guardian && guardianSharing,
    });
    if (res.ok) {
      setEmail("");
      setName("");
      setGuardian(false);
      setGuardianSharingTick(false);
      setNotice(inviteNotice(address, res.invite, true, res.inviteReason));
      report(res);
    } else {
      setError(addErrorText(res.error));
      setPending(null);
    }
  }

  async function onResend(m: AdminMember) {
    setPending(`inv-${m.id}`);
    setNotice(null);
    const res = await resendInvitation(m.id, inviteLang);
    if (res.ok) {
      setNotice(inviteNotice(m.email, "sent", false));
      report(res);
    } else if (res.error === "forbidden" || res.error === "not-found") {
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
    if (!canChange(m) || !grantable.includes(r)) {
      setError(errorText("not-grantable"));
      return;
    }
    const next = m.roles.includes(r)
      ? m.roles.filter((x) => x !== r)
      : [...m.roles, r];
    if (next.length === 0) {
      setError("Everyone needs at least one role. To take all their roles away, remove them.");
      return;
    }
    setPending(`roles-${m.id}`);
    report(await setMemberRoles(m.id, next));
  }

  // A sharing tick shows what was picked at once, until the list the
  // change returns says it (or it failed, or was kept, and goes back).
  const [sharingPicked, setSharingPicked] = React.useState<Record<string, boolean>>({});
  const unpick = (id: string) =>
    setSharingPicked((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  // Taking the sharing part back unshares the learner's Comp Card at once,
  // and ticking it again doesn't share it again: asked first (WCAG 3.3.4).
  const sharingTickId = (id: string) => `${ids}-gs-${id}`;
  const [takingBack, setTakingBack] = React.useState<string | null>(null);
  const [takeBackError, setTakeBackError] = React.useState<string | null>(null);

  async function onGuardianSharing(m: AdminMember, on: boolean) {
    setPending(`gs-${m.id}`);
    setSharingPicked((p) => ({ ...p, [m.id]: on }));
    let res: Awaited<ReturnType<typeof setGuardianSharing>>;
    try {
      res = await setGuardianSharing(m.id, on);
    } catch {
      res = { ok: false as const, error: "no-answer" };
    }
    unpick(m.id);
    report(res);
  }

  function onSharingTick(m: AdminMember, on: boolean) {
    if (on) {
      void onGuardianSharing(m, true);
      return;
    }
    setNotice(null);
    setError(null);
    setConfirming(null);
    setEditing(null);
    setTakeBackError(null);
    setSharingPicked((p) => ({ ...p, [m.id]: false }));
    setTakingBack(m.id);
  }

  /** The question closed unanswered: the tick shows the permission as it is. */
  function dropTakeBack() {
    if (takingBack) unpick(takingBack);
    setTakingBack(null);
    setTakeBackError(null);
  }

  function keepSharing(m: AdminMember) {
    dropTakeBack();
    focusEl(sharingTickId(m.id));
  }

  async function onTakeBack(m: AdminMember) {
    setPending(`gs-${m.id}`);
    setTakeBackError(null);
    let res: Awaited<ReturnType<typeof setGuardianSharing>>;
    try {
      res = await setGuardianSharing(m.id, false);
    } catch {
      res = { ok: false as const, error: "no-answer" };
    }
    if (!res.ok) {
      // The question stays, says why, and can be tried again or kept.
      setTakeBackError(errorText(res.error));
      setPending(null);
      return;
    }
    setTakingBack(null);
    unpick(m.id);
    setNotice({
      kind: "ok",
      text: `The guardian's permission no longer covers sharing the Comp Card of ${m.email}. It is set to “Only me”.`,
    });
    report(res);
    focusEl(sharingTickId(m.id));
  }

  /** The bin asks first; on your own row it says why it can't. */
  function askRemove(m: AdminMember) {
    if (m.id === selfId) {
      setError(errorText("self"));
      return;
    }
    setError(null);
    setConfirmError(null);
    setEditing(null);
    dropTakeBack();
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
    let res: Awaited<ReturnType<typeof removeMember>>;
    try {
      res = await removeMember(m.id);
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
    setNotice({
      kind: "ok",
      text: `Removed ${m.email} from the project. Their account and data stay.`,
    });
    report(res);
    focusEl(near && near.id !== m.id ? binId(near.id) : `${ids}-email`);
  }

  /** "Change details" opens the person's form in place. */
  function openEdit(m: AdminMember) {
    setError(null);
    setEditError(null);
    setConfirming(null);
    dropTakeBack();
    setEditing({
      id: m.id,
      name: m.name ?? "",
      country: m.country ?? "",
      organisationId: m.organisationId ?? "",
    });
  }

  function closeEdit(m: AdminMember) {
    setEditing(null);
    setEditError(null);
    focusEl(editId(m.id));
  }

  async function onSaveEdit(m: AdminMember) {
    if (!editing) return;
    // What changed, as the form shows it (detailChanges).
    const changes = detailChanges(m, editing, { admin, self: m.id === selfId });
    if (Object.keys(changes).length === 0) {
      closeEdit(m);
      return;
    }
    setPending(`ed-${m.id}`);
    setEditError(null);
    let res: Awaited<ReturnType<typeof updatePersonProfile>>;
    try {
      res = await updatePersonProfile(m.id, changes);
    } catch {
      setEditError(errorText("no-answer"));
      setPending(null);
      return;
    }
    if (!res.ok) {
      setEditError(errorText(res.error));
      setPending(null);
      return;
    }
    setNotice({ kind: "ok", text: `Saved the details of ${m.email}.` });
    report(res);
    closeEdit(m);
  }

  const columns = 7;

  function personRows(m: AdminMember) {
    const changeable = canChange(m);
    const self = m.id === selfId;
    const own = cohorts.filter((c) => c.organisationId === m.organisationId);
    const locked = !changeable && !self;
    return (
      <React.Fragment key={m.id}>
        <tr
          className={`border-b border-[var(--border)] ${
            confirming === m.id || editing?.id === m.id ? "" : "last:border-0"
          }`}
        >
          <td className="px-4 py-2.5">
            {m.name ? <div className="font-medium">{m.name}</div> : null}
            <div className="text-[11px] text-[var(--muted-foreground)] break-all">
              {m.email}
            </div>
            {self ? (
              <p
                id={selfHintId}
                className="mt-1 max-w-56 text-[11px] text-[var(--muted-foreground)]"
              >
                {admin
                  ? "This is you. You can't switch off your own Admin role or remove yourself. Another admin can."
                  : "This is you. Only an admin changes your roles or removes you."}
              </p>
            ) : null}
            {locked ? (
              <p
                id={lockedHintId(m.id)}
                className="mt-1 max-w-56 text-[11px] text-[var(--muted-foreground)]"
              >
                Only an admin changes partner admins, editors and admins.
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1">
              {!m.profileComplete ? <span className={chipCls}>Profile not completed</span> : null}
              {m.testAccount ? <span className={chipCls}>Test account</span> : null}
              {m.formerStaff ? <span className={chipCls}>Former staff</span> : null}
              {m.guardianConsent ? (
                <span className={chipCls}>{underAge(minAge, false)}, guardian&apos;s permission recorded</span>
              ) : null}
            </div>
            {m.guardianConsent && changeable && m.roles.length === 1 && m.roles[0] === "LEARNER" ? (
              <label className="mt-1 flex max-w-60 items-start gap-1.5 text-[11px]">
                <input
                  id={sharingTickId(m.id)}
                  type="checkbox"
                  checked={sharingPicked[m.id] ?? m.guardianSharing}
                  disabled={pending === `gs-${m.id}` || takingBack === m.id}
                  onChange={(e) => onSharingTick(m, e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--accent)]"
                />
                <span>
                  The guardian&apos;s permission also covers sharing their Comp Card with our facilitators
                  <span className="sr-only"> ({m.email})</span>
                </span>
              </label>
            ) : null}
          </td>
          <td className="px-3 py-2.5">
            <div className={m.orgName ? "" : "text-[var(--muted-foreground)]"}>
              {m.orgName ?? "No organisation"}
            </div>
            <div className="text-[11px] text-[var(--muted-foreground)]">
              {m.country ? COUNTRY_NAMES[m.country] : "Country not given"}
            </div>
            {m.countryMismatch ? (
              <span className={`${chipCls} mt-1 border-[var(--danger)]/40 text-[var(--danger)]`}>
                Country doesn&apos;t match organisation
              </span>
            ) : null}
          </td>
          <td className="px-3 py-2.5">
            {/* py-1: at least 24px high (WCAG 2.5.8), as the
                chips wrap onto two lines in a narrow column; and 12px
                between the lines, so a chip half under the sticky header
                still has room around it. */}
            <div className="flex flex-wrap gap-x-1 gap-y-3">
              {ROLES.filter((r) => grantable.includes(r.value) || m.roles.includes(r.value)).map((r) => {
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
                // Your own Admin role stays on, and someone this manager
                // may not change stays as they are: focusable, so each
                // can say why (the line under the email).
                const ownAdmin = on && r.value === "ADMIN" && self;
                const fixed = ownAdmin || !changeable;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => toggleRole(m, r.value)}
                    disabled={pending === `roles-${m.id}`}
                    aria-pressed={on}
                    aria-disabled={fixed || undefined}
                    aria-describedby={
                      ownAdmin || (self && !changeable) ? selfHintId : locked ? lockedHintId(m.id) : undefined
                    }
                    className={`rounded-full border px-2 py-1 text-[11px] ${
                      on
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--surface-muted)]"
                    }${fixed ? " cursor-not-allowed" : ""}`}
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
                report(await assignCohort(m.id, e.target.value || null));
              }}
              disabled={pending === `cohort-${m.id}` || !changeable || !m.organisationId}
              aria-label={`Cohort for ${m.email}`}
              className="max-w-44 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
            >
              <option value="">{m.organisationId ? "— none —" : "— no organisation —"}</option>
              {own.map((c) => (
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
                  {m.invitedAt ? `Invited ${m.invitedAt}` : "Not joined yet"}
                </span>
                {m.roles.length > 0 ? (
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
                ) : null}
              </div>
            )}
          </td>
          <td className="px-3 py-2.5 text-[var(--muted-foreground)] tabular-nums">
            {m.joinedAt}
          </td>
          <td className="px-3 py-2.5 text-right whitespace-nowrap">
            {changeable ? (
              <button
                id={editId(m.id)}
                type="button"
                onClick={() => openEdit(m)}
                aria-label={`Change details of ${m.email}`}
                aria-expanded={editing?.id === m.id}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            {changeable || self ? (
              <button
                id={binId(m.id)}
                type="button"
                onClick={() => askRemove(m)}
                aria-label={`Remove ${m.email} from the project`}
                aria-disabled={self || undefined}
                aria-describedby={self ? selfHintId : undefined}
                className={
                  self
                    ? "ml-1 rounded-md p-1 text-[var(--muted-foreground)] opacity-50 cursor-not-allowed"
                    : "ml-1 rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </td>
        </tr>
        {takingBack === m.id ? (
          <tr className="border-b border-[var(--border)] last:border-0">
            <td colSpan={columns} className="p-0">
              <div className="sticky left-0 w-[100cqw] px-4 pb-3">
                <InlineConfirm
                  heading="h2"
                  title={`Take back the guardian's permission to share the Comp Card of ${m.name || m.email}?`}
                  confirmLabel="Take back the permission"
                  keepLabel="Keep it"
                  busy={pending === `gs-${m.id}`}
                  error={takeBackError}
                  onConfirm={() => onTakeBack(m)}
                  onKeep={() => keepSharing(m)}
                >
                  <p className="mt-1 text-xs">
                    Their Comp Card goes back to “Only me” at once, and our
                    facilitators no longer see it. Ticking this again later
                    doesn&apos;t share it again: they choose that themselves.
                  </p>
                </InlineConfirm>
              </div>
            </td>
          </tr>
        ) : null}
        {editing?.id === m.id ? (
          <tr className="border-b border-[var(--border)] last:border-0">
            <td colSpan={columns} className="p-0">
              <div className="sticky left-0 w-[100cqw] px-4 pb-3">
                <EditDetails
                  m={m}
                  draft={editing}
                  onDraft={(patch) => setEditing((d) => (d ? { ...d, ...patch } : d))}
                  onCountry={(country) => setEditing((d) => (d ? { ...d, ...draftWithCountry(m, d, country, mappings) } : d))}
                  mappings={mappings}
                  nameOnly={!admin || self}
                  organisations={organisations}
                  busy={pending === `ed-${m.id}`}
                  error={editError}
                  onSave={() => onSaveEdit(m)}
                  onCancel={() => closeEdit(m)}
                />
              </div>
            </td>
          </tr>
        ) : null}
        {confirming === m.id ? (
          <tr className="border-b border-[var(--border)] last:border-0">
            <td colSpan={columns} className="p-0">
              {/* On a phone the table is scrolled sideways to
                  reach the bin: the question stays at the left
                  of the box and as wide as it, so it opens on
                  screen and wraps (WCAG 1.4.10). */}
              <div className="sticky left-0 w-[100cqw] px-4 pb-3">
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
                  <p className="mt-1 text-xs">{removeNote(admin)}</p>
                </InlineConfirm>
              </div>
            </td>
          </tr>
        ) : null}
      </React.Fragment>
    );
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
            {ownOrganisation ? `Add someone to ${ownOrganisation.name}` : "Add someone to the project"}
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
                maxLength={50}
                className={`${inputCls} w-44`}
              />
            </label>
            <label className="max-w-full text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Role</span>
              {/* Explicit aria-label: a wrapping <label> would fold the
                  selected option text into the accessible name. */}
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                aria-label="Role"
                aria-describedby={selectedIncludes.length ? roleHintId : undefined}
                className={`${inputCls} max-w-full`}
              >
                {offered.map((r) => {
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
            {admin ? (
              <label className="max-w-full text-xs text-[var(--muted-foreground)]">
                <span className="block mb-1">Organisation</span>
                <select
                  value={organisationId}
                  onChange={(e) => setOrganisationId(e.target.value)}
                  aria-label="Organisation"
                  className={`${inputCls} max-w-full`}
                >
                  <option value="">— none (SENIC staff) —</option>
                  {organisations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
          {ownOrganisation ? (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Everyone you add here joins {ownOrganisation.name}. Someone who
              already belongs to another organisation can&apos;t be added from
              here.
            </p>
          ) : null}
          {role === "LEARNER" ? (
            <div className="mt-3 space-y-1.5 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={guardian}
                  onChange={(e) => {
                    setGuardian(e.target.checked);
                    if (!e.target.checked) setGuardianSharingTick(false);
                  }}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                {underAge(minAge, true)}: our organisation holds a parent&apos;s or
                guardian&apos;s permission
              </label>
              {guardian ? (
                <label className="ml-6 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={guardianSharing}
                    onChange={(e) => setGuardianSharingTick(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  That permission also covers sharing their Comp Card with
                  our facilitators
                </label>
              ) : null}
            </div>
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

      {admin ? (
        <label className="flex max-w-full flex-wrap items-center gap-2 text-sm">
          <span>Show</span>
          {/* Explicit aria-label, as the Role select's. */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            aria-label="Show"
            className="max-w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* People */}
      <Card>
        {/* relative: the table's visually hidden headings are positioned,
            and would otherwise escape this scroll box and widen the page.
            @container: the questions in a row are as wide as this box (cqw). */}
        <CardContent className="@container relative p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Organisation</th>
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
                    colSpan={columns}
                    className="px-4 py-6 text-sm text-[var(--muted-foreground)]"
                  >
                    {filter === "all" ? "Nobody in the project yet." : "Nobody on this list."}
                  </td>
                </tr>
              ) : (
                shown.map(personRows)
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A person's details, changed in place: the name (people managers), and
 * the country and organisation (an ADMIN, never their own). A learner's
 * new country picks the organisation it is mapped to, on screen at once
 * (draftWithCountry); another one can be picked before saving.
 */
function EditDetails({
  m,
  draft,
  onDraft,
  onCountry,
  mappings,
  nameOnly,
  organisations,
  busy,
  error,
  onSave,
  onCancel,
}: {
  m: AdminMember;
  draft: DetailsDraft;
  onDraft: (patch: Partial<DetailsDraft>) => void;
  /** A new country picked (it may bring an organisation). */
  onCountry: (country: string) => void;
  /** An ADMIN's country mapping (country → organisation id). */
  mappings: Partial<Record<Country, string>>;
  /** Only the name: a partner admin, or an ADMIN on their own row. */
  nameOnly: boolean;
  organisations: { id: string; name: string }[];
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ids = React.useId();
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const learner = learnerOnly(m);
  // Said (and announced) once a learner's country is changed: which
  // organisation that country's learners join, as the select now shows.
  const newCountry = !nameOnly && learner && !!draft.country && draft.country !== (m.country ?? "");
  const mappedId = newCountry ? mappings[draft.country as Country] : undefined;
  const mappedName = organisations.find((o) => o.id === mappedId)?.name;
  const brought = newCountry
    ? `${COUNTRY_NAMES[draft.country as Country]}: ` +
      (mappedName ? `learners join ${mappedName}.` : "no organisation supports it yet.")
    : "";
  return (
    <div
      role="group"
      aria-labelledby={`${ids}-h`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onCancel();
      }}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3"
    >
      <h2 id={`${ids}-h`} ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
        Change details of {m.name || m.email}
      </h2>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted-foreground)]">
          <span className="block mb-1">Name</span>
          <input
            value={draft.name}
            onChange={(e) => onDraft({ name: e.target.value })}
            maxLength={50}
            className={`${inputCls} w-48`}
          />
        </label>
        {nameOnly ? null : (
          <>
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Country</span>
              <select
                value={draft.country}
                onChange={(e) => onCountry(e.target.value)}
                aria-label="Country"
                className={inputCls}
              >
                {draft.country ? null : <option value="">— not given —</option>}
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_NAMES[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted-foreground)]">
              <span className="block mb-1">Organisation</span>
              <select
                value={draft.organisationId}
                onChange={(e) => onDraft({ organisationId: e.target.value })}
                aria-label="Organisation"
                className={inputCls}
              >
                <option value="">— none —</option>
                {organisations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <Button size="sm" onClick={onSave} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {nameOnly ? null : (
        <>
          {/* Polite: picking a country also changes the Organisation select. */}
          <p role="status" className="mt-2 text-xs font-medium">
            {brought}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {learner
              ? "A learner's new country brings the organisation that supports it; you can pick another one before saving. "
              : "A staff member's organisation doesn't follow their country. "}
            A new organisation sets their Comp Card back to “Only me” and
            takes them out of another organisation&apos;s cohort.
          </p>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)] flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
