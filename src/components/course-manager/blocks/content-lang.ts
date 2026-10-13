/**
 * Content fields carry the language they are written in (spec 11.3,
 * WCAG 3.1.2), while the controls around them keep the page's language.
 * For editors whose boxes are drawn by shared components (the text's
 * BlockList), the boxes are marked after rendering.
 */

/** The boxes an author writes content in: text inputs, text areas, rich text. */
export const CONTENT_FIELDS =
  'input[type="text"], input:not([type]), textarea, [contenteditable="true"]';

/** Marks every content box under `root` with `lang`. */
export function markContentLang(root: ParentNode, lang: string): void {
  for (const box of Array.from(root.querySelectorAll(CONTENT_FIELDS))) {
    if (box.getAttribute("lang") !== lang) box.setAttribute("lang", lang);
  }
}
