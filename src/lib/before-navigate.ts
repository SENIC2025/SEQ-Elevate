/**
 * "About to leave this page — any objections?" for navigations a page can't
 * see coming, like the header's language select (it changes the address
 * itself). A page holding unsaved work listens and cancels; the header never
 * has to know which pages those are.
 */

export const BEFORE_NAVIGATE = "seq:before-navigate";

export type BeforeNavigateReason = "ui-language";

/** Ask the open page; false when it asked the person and they said no. */
export function mayNavigate(reason: BeforeNavigateReason): boolean {
  if (typeof window === "undefined") return true;
  return window.dispatchEvent(
    new CustomEvent<{ reason: BeforeNavigateReason }>(BEFORE_NAVIGATE, {
      cancelable: true,
      detail: { reason },
    })
  );
}
