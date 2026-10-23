/**
 * A reviewer's marks in a paste, taken out before the editor reads it
 * (paste-cleanup.ts, first): what a learner reads is the text with every
 * tracked change accepted and no comment in it.
 *
 * - Word's tracked deletions go, with their text. Word desktop (Windows and
 *   Mac) writes each as <span class=msoDel><del cite="mailto:…"
 *   datetime="…">; a moved passage's old place is one too. So a <del> goes
 *   when it carries one of Word's marks: the class msoDel (its own or a
 *   span's around it), the author as Word writes it (cite "mailto:" and the
 *   name), the time as Word writes it (datetime to the minute, as
 *   "2026-10-20T09:14"), or a page Word wrote around it (its generator,
 *   program id or namespace: Word writes struck-through text as <s>, never
 *   <del>). Word for the web's deleted run (class TrackChangeTextDeletion)
 *   goes, and <w:del> should a clipboard carry Word's own element. Any
 *   other <del> is text and keeps its words, as a web page's or Markdown's
 *   strikethrough (GitHub, Obsidian and Typora draw it as <del>); the
 *   editor reads them as plain text.
 * - Tracked insertions stay, as text: <ins> and <w:ins> are unwrapped (the
 *   spans around them are dropped by the schema, as every span is).
 * - Word's comments go: the reference after the commented words ("[MT1]",
 *   an anchor of class msocomanchor to #_msocom_1, in a span of class
 *   MsoCommentReference with Word's comment mark), and the comments
 *   themselves, which Word puts after the text in a block styled
 *   mso-element:comment-list, each in a block styled mso-element:comment
 *   ("Logo bitte aktualisieren"): those blocks go whole. A paragraph in a
 *   comment's style outside them (Comment Text, class MsoCommentText, as
 *   text copied out of a comment is; Comment Subject; a comment's block of
 *   class msocomtxt) is text and stays. The commented words stay (Word
 *   wraps them in an anchor styled mso-comment-reference; it is
 *   unwrapped). Word for the web marks commented words with classes only
 *   and puts no comment on the clipboard.
 *
 * LibreOffice leaves a tracked deletion's text out when it copies, and
 * writes a comment as an HTML comment, which the editor never reads: its
 * clipboard needs nothing here.
 *
 * Written after Word's HTML (a document Word saved as a web page with
 * comments; a Word for Mac clipboard with tracked changes) and Word for the
 * web's markup on pages pasted into from it; the partners' clipboards of
 * 9 November confirm it (e2e/fixtures/paste). A paragraph whose mark a
 * reviewer deleted stays a paragraph of its own.
 *
 * Browser only (a DOMParser document, as paste-cleanup.ts).
 */
export function removeReviewMarks(root: HTMLElement) {
  for (const el of Array.from(root.querySelectorAll(REMOVED))) {
    // An element inside one already removed is gone with it.
    if (el.isConnected) el.remove();
  }
  const fromWord = wordWrote(root.ownerDocument);
  for (const el of Array.from(root.getElementsByTagName("del"))) {
    if (el.isConnected && (fromWord || hasWordsChangeMarks(el))) el.remove();
  }
  for (const el of Array.from(root.getElementsByTagName("w:del"))) {
    if (el.isConnected) el.remove();
  }
  for (const el of [...Array.from(root.querySelectorAll(UNWRAPPED)), ...Array.from(root.getElementsByTagName("w:ins"))]) {
    if (el.isConnected) el.replaceWith(...Array.from(el.childNodes));
  }
}

/** Deleted text in Word's own markup, comment references and the comments themselves. */
const REMOVED = [
  // Tracked deletions: Word desktop's class (on the <del> or a span around
  // it) and Word for the web's deleted run.
  ".msoDel",
  ".TrackChangeTextDeletion",
  // A comment's reference after the commented words, and Word's mark for it.
  "a.msocomanchor",
  "a[href^='#_msocom_']",
  ".MsoCommentReference",
  "[style*='mso-special-character:comment']",
  "[style*='mso-special-character: comment']",
  // The comments, after the text: Word's comment list and each comment in
  // it, whole, with the comments' paragraphs (MsoCommentText,
  // MsoCommentSubject) and blocks (msocomtxt) inside.
  "[style*='mso-element:comment']",
  "[style*='mso-element: comment']",
  ".msocomoff",
  "a[name^='_msocom_']",
].join(", ");

/** Inserted text, and the commented words: kept, without their wrapper. */
const UNWRAPPED = "ins, a[style*='mso-comment-reference']";

/** Word's author on a tracked change: cite="mailto:Maria%20Trainerin". */
const WORD_AUTHOR = /^mailto:/i;
/** Word's time on a tracked change, to the minute: datetime="2026-10-20T09:14". */
const WORD_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;

/** Does a <del> carry the author or the time Word writes on a tracked change? */
function hasWordsChangeMarks(el: Element): boolean {
  return WORD_AUTHOR.test(el.getAttribute("cite") ?? "") || WORD_TIME.test((el.getAttribute("datetime") ?? "").trim());
}

/** Word's namespace, on a page Word wrote. */
const WORD_NAMESPACE = "urn:schemas-microsoft-com:office:word";

/**
 * Did Word write the pasted page? Its generator ("Microsoft Word 15", also
 * Outlook's "Microsoft Word 15 (filtered medium)"), its program id
 * (Word.Document) or Word's namespace on the page says so.
 */
function wordWrote(doc: Document): boolean {
  if (doc.documentElement?.getAttribute("xmlns:w")?.trim() === WORD_NAMESPACE) return true;
  return Array.from(doc.getElementsByTagName("meta")).some((meta) => {
    const name = meta.getAttribute("name")?.trim().toLowerCase();
    const content = meta.getAttribute("content")?.trim() ?? "";
    return (name === "generator" && /^Microsoft Word\b/i.test(content)) || (name === "progid" && /^Word\./i.test(content));
  });
}
