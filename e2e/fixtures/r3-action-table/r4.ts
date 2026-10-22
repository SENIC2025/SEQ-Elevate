import type { Row } from "./kit";

/**
 * The action table's rows for Release 4's Part B (spec 10.5): every export of
 * src/app/actions/lesson-reading.ts. They come with that file's "use server"
 * directive, the screen that calls its actions (the lesson's document card)
 * and their registration with e2e/r3-actions.spec.ts and index.ts, together,
 * from Mon 16 Nov (D102): an action a request can reach has its row from the
 * first build that serves it. Until then the file is server-only, the build
 * gives its exports no action id (e2e/r4-further-reading.spec.ts checks it),
 * and src/app/actions/lesson-reading.test.ts and lesson-reading.db.test.ts
 * try each export as each role, with the out-of-scope project's rows.
 */

export const rows: Row[] = [];
