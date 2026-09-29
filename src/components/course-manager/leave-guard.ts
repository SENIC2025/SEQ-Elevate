/**
 * Does a click on a link take this tab to another page? In-app links move
 * without a reload, so the browser's own "leave page?" prompt never shows —
 * the course page asks itself when one of them would drop unsaved edits.
 * Pure, so the rules are unit-tested.
 */

export interface LinkClick {
  /** 0 = main button. */
  button: number;
  /** Any of Ctrl, ⌘, Shift, Alt: opens a new tab or window, nothing is lost. */
  modified: boolean;
  /** Someone already handled the click. */
  defaultPrevented: boolean;
  /** The link's resolved address, its target and whether it downloads. */
  href: string;
  target: string;
  download: boolean;
}

export function leavesPage(click: LinkClick, here: string): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.modified) {
    return false;
  }
  if (click.download || (click.target && click.target !== "_self")) {
    return false;
  }
  let to: URL;
  let from: URL;
  try {
    to = new URL(click.href, here);
    from = new URL(here);
  } catch {
    return false;
  }
  // Another site: the browser's own prompt (beforeunload) covers it.
  if (to.origin !== from.origin) return false;
  // Same page (the lesson list's #lesson-… anchors, ?lesson=…): the page
  // stays mounted, so nothing is lost. A different path — another page, or
  // the same page in another menu language — starts over.
  return to.pathname !== from.pathname;
}
