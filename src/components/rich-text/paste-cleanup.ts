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
    return body.innerHTML;
  } catch {
    return html;
  }
}

const WORD_HTML = /class=["']?Mso|urn:schemas-microsoft-com:office|mso-list/i;

/** `mso-list:l0 level2 lfo1` → list "l0", level 2. */
const MSO_LIST = /mso-list:\s*(l\d+)\s+level(\d+)/i;
const MSO_IGNORE = /mso-list:\s*ignore/i;

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
