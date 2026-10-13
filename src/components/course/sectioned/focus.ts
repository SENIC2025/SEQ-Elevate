/**
 * Move focus to the element `id` first, while the control being pressed
 * still has it, then act. For a button that goes away when pressed ("Try
 * another", "Check answers", …): focus lands on something that stays — the
 * part's heading — instead of dropping to the page (WCAG 2.4.3). A lesson
 * holds many parts and one Continue at the bottom, so losing the place
 * costs a keyboard or screen-reader user a lot.
 */
export function focusThen(id: string, act: () => void): void {
  document.getElementById(id)?.focus();
  act();
}
