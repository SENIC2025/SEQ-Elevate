import { useTranslations } from "next-intl";

/** The emergency number, in every country the platform serves (D93: in code, never a setting). */
export const EMERGENCY_NUMBER = "112";

/**
 * "In an emergency, call 112." in the page's language, with 112 a link that
 * calls it, as every contact's number is (ContactList). The sentence is the
 * message as written; only the number in it becomes the link.
 */
export function EmergencyLine() {
  const t = useTranslations("safeguarding");
  const text = t("emergency");
  const at = text.indexOf(EMERGENCY_NUMBER);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <a href={`tel:${EMERGENCY_NUMBER}`} className="underline underline-offset-2 hover:text-[var(--accent)]">
        {EMERGENCY_NUMBER}
      </a>
      {text.slice(at + EMERGENCY_NUMBER.length)}
    </>
  );
}
