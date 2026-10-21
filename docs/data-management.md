# Data management guide

How personal data on SEQ Elevate is looked after day to day: data requests,
test accounts, the clean-up run, and restores. For DIESIS (the controller), SENIC
(the processor, which operates the platform) and the platform's admins. The
technical description is [DATA-PROTECTION.md](../DATA-PROTECTION.md); backups are
in [BACKUP.md](../BACKUP.md); the go-live steps in [GO-LIVE.md](../GO-LIVE.md).

**One rule above the others: nobody edits the production database by hand.** Every
change to someone's data goes through the platform, which checks who may make it and
logs it. The owner may run read-only queries (counts, or the address that belongs to
an account id) when a step below says so.

## 1. Who does what

| Who | Does |
|---|---|
| **DIESIS** (controller) | Receives data requests, checks who is asking, decides, and keeps the register (§2). Watches the go-live clean-up run. |
| **SENIC** (processor) and the platform's **ADMINs** | Carry out requests on DIESIS's instruction, on **Admin → Data** (`/admin/data`). Run the clean-up. |
| **Partner admins** and **facilitators** | Pass any data request they receive to DIESIS. They have no data tools. |
| **Learners** | Download their own data and delete their own account on their **Account** page, at any time, without asking anyone. |

## 2. The register of data requests

DIESIS keeps the register outside the platform, one line per request:

| Field | Example |
|---|---|
| Reference | `REQ-2026-004` |
| Received (date, channel) | 2026-12-03, email to DIESIS |
| What is asked | access, erasure, correction, restriction, objection |
| How the person's identity was checked | e.g. reply from the account's address |
| Decision and reason | carried out / refused, why |
| Done (date, by whom) | 2026-12-05, SENIC |

**References** are `REQ-` + the year + a three-digit number, counted from `001` each
year (`REQ-2026-001`, `REQ-2026-002`, …). The platform accepts nothing else. A reference
is stored in the platform's log, in rows that outlive an erased account, so it must
**never contain a name, an address or any other detail** of the person: the register
holds those, the platform only the reference.

## 3. Handling a request

Always on DIESIS's instruction, with the register's reference to hand.

**Access (a copy of the data).** The person can download it themselves (Account →
Your data). For a request made another way: **Admin → Data → Find a person** (part of
the address is enough; people removed from the project and accounts that never
finished the profile step are found too) → **Export data** → the reference →
**Download their data**. The file holds everything the platform has about the person,
their Comp Card and course reflections included, whatever they chose to share. Send it
to the person as DIESIS decides; delete your copy afterwards. The download is logged
(`account.exported`, with the reference).

**Erasure.** The person can delete their own account (Account → Delete your account).
For a request made another way: **Find a person** → **Erase** → type their address
again and the reference → **Erase for good**. In one step, the platform deletes:

- the account, its roles and profile, its sessions;
- course progress and answers, the Comp Card, badges;
- the notes and validations staff wrote about them;
- their activity records (courses opened, time on lessons, video answers);
- their pending sign-in links and their rate-limit records.

Log rows about the person lose the link to them. One record that an account was deleted
stays (the account's id, the date, who erased it and the reference; no name, no
address), so the erasure can be applied again after a restore (§7). Notes and
validations the person wrote **about others** (as staff) stay, without their name.

The platform refuses to erase or reset: your own account (another admin can); the
project's last admin; an address on `ADMIN_EMAILS` (its roles would come back at the
next sign-in: ask SENIC to remove the address from `ADMIN_EMAILS` first).

**Correction.** Learners can't change their own name or country. An admin changes a
learner's name, country or organisation on **Manage people**. Email addresses can't be
changed in the platform: erase the account on request, and the person signs up again.

**Restriction or objection.** DIESIS decides. Usual answers: the person sets their Comp
Card to "Only me"; an admin removes the person from the project (Manage people →
Remove: the account and its data stay); or erasure.

## 4. Test accounts

Test accounts are accounts that don't belong to a real learner: staff trying courses,
partner QA, the security review's accounts, the showcase profiles.

- **Mark** them on Admin → Data, one at a time (Find a person) or ticked on the review
  lists. A marked account is left out of statistics at once, carries a "Test account"
  label on the rosters, and is erased by the next clean-up run.
- **Reset** a marked account to start a test again: its sessions end first (open tabs
  stop saving), then its progress, answers, Comp Card, badges and the notes about it are
  deleted. The account, its roles and its profile stay, so the tester doesn't repeat
  the sign-up screen.
- **Erase** a marked account at any time; it needs no reference.
- The review lists on Admin → Data find accounts worth checking: learner data without a
  completed profile; the showcase profiles' addresses; learner data from before
  statistics start; staff who also played courses; accounts changed on People that never
  held a staff role; accounts a partner admin added that never signed in; and countries
  that don't match the organisation.

## 5. The clean-up run

On **Admin → Data → Clean-up**. It erases the marked test accounts (one at a time, each
recorded with the reference `CLEANUP-<run>`), ends every demo session, deletes expired
sessions and expired sign-in links, and deletes queued course files (§6).

1. **Mark** the test accounts (§4).
2. **Dry run.** It changes nothing and shows, per table, what a run would delete now,
   the marked accounts it would leave and why, and created courses still live that only
   test accounts or staff took (ask the editors to archive them).
3. **Rehearse** before the first run on the live site: the owner makes a fresh Neon
   branch of production, a preview is deployed against that branch, and the run is done
   there for real. Compare its counts with the live dry run.
4. **Run.** Type exactly `ERASE <n> TEST ACCOUNTS`, with n the number the dry run shows,
   and **Run the clean-up**. DIESIS watches the go-live run.

Every run is recorded as `data.cleanup_run` with its counts (never an address) and shows
in the log on the same page. An account or a file that couldn't be deleted is listed;
run again later. A second run does only what has become due since.

**When:** before launch (the go-live run, GO-LIVE.md §2b), then **monthly** during the
pilot, and after each round of testing.

## 6. Course files

Files uploaded for lessons (videos, posters, captions, documents) are stored at public
addresses that can't be guessed. When an editor removes one from a lesson (removes a
document, clears or replaces a video, deletes a lesson), the file is **queued**, not
deleted. The clean-up run deletes a queued file once it has been queued for **7 days**
and no lesson uses it; a file pasted back into a lesson within those days leaves the
queue and stays. Only the live site deletes files, and only from its own store; other
deployments list due files as "kept (not production)". Until the run deletes it, a
removed file stays reachable by its address. A database restored to before a run can
point at a file the run has deleted.

## 7. Backups and restores

Backups are described in [BACKUP.md](../BACKUP.md). After a restore, before anyone uses
the restored data, every erasure made after the backup's date is applied again (BACKUP.md,
R10): each erasure left an `account.deleted` record with the account's id, and every
daily backup carries these records. Corrections are made again from the register.

## 8. Staff notes

Notes and validations staff write about a learner are in the learner's data download,
signed "a facilitator at ‹organisation›", never by name. Learners can read them there.
Write them as you would want the learner to read them: factual, about what happened.

## 9. The log

The log on Admin → Data shows the last 200 data and account records: exports and
erasures (by admins and by people themselves), resets and test marks, organisation and
country changes, refused additions on Manage people, guardian permissions recorded,
safeguarding saves and clean-up runs; with the date, the action, and who (an admin's
address, or "the account holder"). No learner's name. DIESIS checks it monthly, and every
export there has a reference in the register.
