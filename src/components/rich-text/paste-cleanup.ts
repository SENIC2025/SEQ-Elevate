import {
  listTreeToHtml,
  nestListItems,
  parseWordMarker,
  type FlatListItem,
  type ListKind,
} from "./word-list";

/**
 * Pasted HTML, tidied before the editor reads it (its transformPastedHTML).
 *
 * The editor's schema already keeps only paragraphs, line breaks, bold,
 * italic and lists when it parses a paste: fonts, colours, sizes, links,
 * images and tables' layout are dropped there, and every change is
 * sanitized again. What the schema can't do is recognise lists that aren't
 * written as lists, so this does, in the pasted HTML:
 *
 * - Word: each list point is a paragraph styled `mso-list:l0 level2 …`, its
 *   bullet or number drawn by a marker span Word asks others to ignore. They
 *   become real <ul>/<ol> (word-list.ts), and Word's empty <o:p> fillers go.
 * - Google Docs and others: a sub-list placed straight inside its parent
 *   list moves into the point above it, and a list whose points only carry
 *   their level as `aria-level` is nested again.
 * - Blank lines go — Word's empty paragraphs, the <br> Google Docs puts
 *   between paragraphs, a break at the start or end of a paragraph. The
 *   editor would show each as a gap that learners never see, since the
 *   stored text drops them (sanitizeRichText).
 *
 * Other HTML passes through unchanged. Browser only (DOMParser — its
 * documents never run scripts or load images); on any failure the HTML is
 * returned as it came, and the schema still cleans it.
 */
export function cleanPastedHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    if (WORD_HTML.test(html)) {
      removeOfficeFillers(body);
      rebuildWordLists(body);
    }
    liftStrayLists(body);
    nestAriaLevels(body);
    removeBlankLines(body);
    return body.innerHTML;
  } catch {
    return html;
  }
}

const WORD_HTML = /class=["']?Mso|urn:schemas-microsoft-com:office|mso-list/i;

/** `mso-list:l0 level2 lfo1` → list "l0", level 2. */
const MSO_LIST = /mso-list:\s*(l\d+)\s+level(\d+)/i;
const MSO_IGNORE = /mso-list:\s*ignore/i;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

/** <o:p> ends each Word paragraph, often holding only a no-break space. */
function removeOfficeFillers(root: HTMLElement) {
  for (const el of Array.from(root.getElementsByTagName("o:p"))) {
    if (el.textContent?.replace(/\s/g, "")) {
      el.replaceWith(...Array.from(el.childNodes));
    } else {
      el.remove();
    }
  }
}

/** Runs of neighbouring Word list paragraphs, each rebuilt as real lists. */
function rebuildWordLists(root: HTMLElement) {
  const paragraphs = Array.from(root.querySelectorAll("p")).filter((p) =>
    MSO_LIST.test(p.getAttribute("style") ?? "")
  );
  let run: HTMLElement[] = [];
  for (const p of paragraphs) {
    const last = run[run.length - 1];
    if (last && nextElement(last) !== p) {
      replaceWithLists(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) replaceWithLists(run);
}

/** The next sibling element, stepping over blank text and comments. */
function nextElement(el: Element): Node | null {
  let node = el.nextSibling;
  while (
    node &&
    (node.nodeType === COMMENT_NODE ||
      (node.nodeType === TEXT_NODE && !node.textContent?.trim()))
  ) {
    node = node.nextSibling;
  }
  return node;
}

function replaceWithLists(run: HTMLElement[]) {
  const items = run.map((p): FlatListItem => {
    const [, list, level] = MSO_LIST.exec(p.getAttribute("style") ?? "") ?? [];
    let marker = "";
    for (const span of Array.from(p.querySelectorAll("span"))) {
      if (MSO_IGNORE.test(span.getAttribute("style") ?? "")) {
        marker ||= span.textContent ?? "";
        span.remove();
      }
    }
    const { kind, start } = parseWordMarker(marker);
    return {
      level: Number(level),
      kind,
      start,
      list,
      html: `<p>${p.innerHTML}</p>`,
    };
  });
  insertHtmlBefore(run[0], listTreeToHtml(nestListItems(items)));
  for (const p of run) p.remove();
}

function insertHtmlBefore(anchor: Element, html: string) {
  const template = anchor.ownerDocument.createElement("template");
  template.innerHTML = html;
  anchor.before(template.content);
}

/**
 * <ul><li>A</li><ul><li>A1</li></ul></ul> — a sub-list straight inside its
 * parent list — becomes <ul><li>A<ul><li>A1</li></ul></li></ul>, so it
 * nests under A instead of under an empty point.
 */
function liftStrayLists(root: HTMLElement) {
  for (const list of Array.from(
    root.querySelectorAll("ul > ul, ul > ol, ol > ul, ol > ol")
  )) {
    const prev = list.previousElementSibling;
    if (prev?.tagName === "LI") prev.appendChild(list);
  }
}

/** One list whose points say their level only as aria-level="2": nest it. */
function nestAriaLevels(root: HTMLElement) {
  for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
    if (!list.isConnected) continue;
    const points = Array.from(list.children);
    if (points.length < 2 || points.some((el) => el.tagName !== "LI")) continue;
    const levels = points.map(
      (li) => Number(li.getAttribute("aria-level")) || 1
    );
    if (new Set(levels).size < 2) continue;
    const kind: ListKind = list.tagName === "OL" ? "number" : "bullet";
    const start = Number(list.getAttribute("start")) || 1;
    const items = points.map(
      (li, i): FlatListItem => ({
        level: levels[i],
        kind,
        start,
        html: li.innerHTML,
      })
    );
    insertHtmlBefore(list, listTreeToHtml(nestListItems(items)));
    list.remove();
  }
}

/** Elements that start a line of their own (ProseMirror reads them so). */
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
  "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR",
  "LI", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH",
  "THEAD", "TR", "UL",
]);
const BLOCKS = Array.from(BLOCK_TAGS, (tag) => tag.toLowerCase()).join(",");

/** Elements that hold lines and show nothing when they hold no text. */
const LINE_HOLDERS = "p, div, li, ul, ol, h1, h2, h3, h4, h5, h6";

const isBlank = (text: string | null) => !text?.replace(/\s/g, "");

/**
 * Is there text beside `br` on its line (`forward`: after it, otherwise
 * before it)? Looks past blank text, comments, other breaks and inline
 * wrappers (Google Docs wraps its whole paste in a <b>), up to the edge of
 * the block the line is in.
 */
function textBeside(br: Element, root: Element, forward: boolean): boolean {
  let at: Node = br;
  for (;;) {
    for (
      let node = forward ? at.nextSibling : at.previousSibling;
      node;
      node = forward ? node.nextSibling : node.previousSibling
    ) {
      if (node.nodeType === TEXT_NODE) {
        if (!isBlank(node.textContent)) return true;
      } else if (node.nodeType === ELEMENT_NODE) {
        const el = node as Element;
        if (BLOCK_TAGS.has(el.tagName) || el.querySelector(BLOCKS)) {
          return false;
        }
        if (!isBlank(el.textContent)) return true;
      }
    }
    const parent = at.parentNode;
    if (
      !parent ||
      parent === root ||
      BLOCK_TAGS.has((parent as Element).tagName)
    ) {
      return false;
    }
    at = parent;
  }
}

/**
 * Line breaks that don't sit between two pieces of text on one line go —
 * one on its own between paragraphs, or at either end of one — and then
 * every paragraph, list and point left without text. (Breaks between two
 * lines of text stay, however many: learners see those.)
 */
function removeBlankLines(root: HTMLElement) {
  for (const br of Array.from(root.querySelectorAll("br"))) {
    if (!textBeside(br, root, false) || !textBeside(br, root, true)) {
      br.remove();
    }
  }
  // Innermost first, so a list emptied of its points goes too.
  for (const el of Array.from(root.querySelectorAll(LINE_HOLDERS)).reverse()) {
    if (isBlank(el.textContent)) el.remove();
  }
}
