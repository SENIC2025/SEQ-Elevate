# Legal texts: dropping in counsel's final wording

How the platform's legal pages (privacy notice, Terms of use, cookies,
accessibility statement, legal notice) get their final text. For SENIC, who
commits the texts counsel delivers. The rules behind it are decision D94.

**One rule above the others: only final text is committed.** The repository is
public. Drafts, notes for DIESIS and texts still under review stay in the
private drafts folder and never enter a commit, a pull request or a branch.

## 1. Where the texts live

| What | Where |
|---|---|
| A final text | `src/content/legal/<language>/<document>.ts`: language `en`, `de` or `el`; document `privacy`, `terms`, `cookies`, `accessibility` or `notice` |
| The list of final texts | `src/content/legal/index.ts`: one import line per file |
| The texts written before counsel's | `LEGACY` in `src/data/legal.ts` (English only; open points show as highlighted boxes) |
| The page | `src/app/[locale]/legal/[doc]/page.tsx` |
| The rules the texts are checked against | `src/data/legal.test.ts` |

A page shows the final text in its own language, else the English final text
(with a note in the page's language that the translation is on its way), else
the text written before counsel's. A document without any text has no page and
no footer link: the legal notice appears, in every footer and in the emails'
footers, from the commit that adds `en/notice.ts`.

## 2. The format

A text file looks like this:

```ts
import type { LegalText } from "@/data/legal";

export default {
  title: "Privacy notice",
  version: "2026-11-06",
  lastUpdated: "2026-11-06",
  body: `
## Who is responsible for your data

DIESIS decides how and why your data is used.

- Email: [privacy@example.org](mailto:privacy@example.org)
`,
} satisfies LegalText;
```

- **`version`** changes with every new wording. A profile records the version of
  the **English Terms of use** a person accepted: a new English Terms version asks
  every account to accept the Terms again on its next visit. A new translation, or
  a new version of another document, asks nobody.
- **`lastUpdated`** is the date the wording last changed, `YYYY-MM-DD`. The page
  shows "Version … · last updated …".
- **`body`** is written in a small part of Markdown (`src/lib/legal-markdown.ts`),
  and nothing else:
  - `## Heading` and `### Heading`;
  - paragraphs, separated by a blank line. A line break inside a paragraph is a
    line break on the page, so an address or numbered points (`1.`, `a)`) keep
    their lines: write each paragraph of running text on one line;
  - lists: `- item`, and `  - item` (two spaces in) for a second level; a line
    under an item carries it on, on a new line;
  - tables: a header row, a `|---|---|` row, then the rows;
  - `**bold**`;
  - links `[words](address)`, where the address is `https://…`, `mailto:…`,
    `/legal/<document>` or `/help` (the page adds the reader's language).
  Anything else shows as it is written, as plain text. A link to any other
  address is shown as text, and the test refuses it.
- Inside the backticks, write `` \` `` for a backtick and `\${` for `${`. A Markdown
  backslash (`\*`, `\|`) is written twice: `\\*`, `\\|`.
- A `[` is only for a link: the test refuses any other, with a backslash before
  it too, since a bracket is how a draft marks what is missing. Write `(…)`.

## 3. Dropping a text in

1. Convert counsel's document to the format above. Keep counsel's words; change
   only the layout.
2. Create the file, and add its import line to `src/content/legal/index.ts`.
3. Run `pnpm test src/data/legal.test.ts`. It fails on:
   - a `[` that starts no link (a placeholder such as `[DIESIS address]`);
   - a draft's words: "For DIESIS", "SENIC to confirm", "Until 20 November",
     "From 20 November", "To be completed", "TODO", "TBD";
   - an empty `version` or `lastUpdated`, or the legacy version `pre-counsel`;
   - a link the page can't show, or a link to a document that has no text;
   - a German or Greek file without its English one;
   - a file that isn't in `index.ts`, or a line in `index.ts` without its file.
   Then run the whole unit suite (`pnpm test`).
4. Open the page in each language (`/en/legal/<document>`, `/de/…`, `/el/…`) and
   check the headings, lists, tables and links.
5. Commit with a message that says which text is added, and open a pull request.
   After the Release 3 deploy, these are content-only commits: they touch only
   `src/content/legal/**` (and, with the last English text, step 6).

## 4. The last English text

The commit that adds the last of the five English texts also deletes, in the same
commit, everything that could still draw a placeholder box:

- the `LEGACY` texts, `LegalSection` and its `needs` field in `src/data/legal.ts`
  (and the `legacy` kind of `LegalDoc`);
- `LegacyBody` and the `legal.toBeCompleted` line in the legal page.

`src/data/legal.test.ts` fails until that is done ("launch day").

## 5. Checks on the live site

`e2e/r3-legal.spec.ts` has two parts:

- **F-E1a** runs in every end-to-end run: every legal page has its main landmark,
  its version line and `lang="en"` on English shown under German or Greek; a
  document with a final text shows no placeholder; every footer link opens a page.
- **F-E1b** (tagged `@launch`) checks that no legal page, in any language, shows a
  placeholder box or a bracket placeholder. It fails while any legacy text is left,
  so it is not part of the release check; it is a go/no-go item on 30 November,
  run read-only against the live site:

  ```sh
  E2E_LAUNCH=1 npx playwright test e2e/r3-legal.spec.ts --grep @launch
  ```

  with a Playwright config whose `baseURL` is the live site and that starts no
  server (the test reads pages only; it needs no database).
