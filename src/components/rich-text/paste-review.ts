/**
 * A reviewer's marks in a paste, taken out before the editor reads it
 * (paste-cleanup.ts, first): what a learner reads is the text with every
 * tracked change accepted and no comment in it.
 *
 * - Tracked deletions go, with their text: <del> (Word desktop, Windows
 *   and Mac, writes each as <span class=msoDel><del cite="mailto:…"
 *   datetime="…">; a moved passage's old place is one too), a span of
 *   class msoDel, Word for the web's deleted run (class
 *   TrackChangeTextDeletion), and <w:del> should a clipboard carry Word's
 *   own element. Word writes struck-through text as <s>, never <del>, and
 *   any other page's <del> is text it shows as removed: it goes too.
 * - Tracked insertions stay, as text: <ins> and <w:ins> are unwrapped (the
 *   spans around them are dropped by the schema, as every span is).
 * - Word's comments go: the reference after the commented words ("[MT1]",
 *   an anchor of class msocomanchor to #_msocom_1, in a span of class
 *   MsoCommentReference with Word's comment mark), and the comments
 *   themselves, which Word puts after the text in a block styled
 *   mso-element:comment-list ("Logo bitte aktualisieren"). The commented
 *   words stay (Word wraps them in an anchor styled mso-comment-reference;
 *   it is unwrapped). Word for the web marks commented words with classes
 *   only and puts no comment on the clipboard.
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
  for (const el of Array.from(root.getElementsByTagName("w:del"))) {
    if (el.isConnected) el.remove();
  }
  for (const el of [...Array.from(root.querySelectorAll(UNWRAPPED)), ...Array.from(root.getElementsByTagName("w:ins"))]) {
    if (el.isConnected) el.replaceWith(...Array.from(el.childNodes));
  }
}

/** Deleted text, comment references and the comments themselves. */
const REMOVED = [
  // Tracked deletions.
  "del",
  ".msoDel",
  ".TrackChangeTextDeletion",
  // A comment's reference after the commented words, and Word's mark for it.
  "a.msocomanchor",
  "a[href^='#_msocom_']",
  ".MsoCommentReference",
  "[style*='mso-special-character:comment']",
  "[style*='mso-special-character: comment']",
  // The comments, after the text.
  "[style*='mso-element:comment']",
  "[style*='mso-element: comment']",
  ".msocomoff",
  ".msocomtxt",
  ".MsoCommentText",
  ".MsoCommentSubject",
  "a[name^='_msocom_']",
].join(", ");

/** Inserted text, and the commented words: kept, without their wrapper. */
const UNWRAPPED = "ins, a[style*='mso-comment-reference']";
