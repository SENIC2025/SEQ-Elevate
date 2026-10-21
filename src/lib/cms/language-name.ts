/**
 * A language's name inside a sentence of the page's language. The message
 * catalogue names each language as a label ("Γερμανικά", "Deutsch",
 * "German"); in a Greek sentence a language's name is written in lower
 * case ("στα γερμανικά"), while German and English capitalise it. And a
 * Greek sentence that starts with the name still starts with a capital
 * (sentenceStart).
 *
 * Pure, so client components can use it too.
 */

/** `name` as it reads inside a sentence of `uiLocale`. */
export function nameInSentence(name: string, uiLocale: string): string {
  return uiLocale === "el" ? name.toLocaleLowerCase("el") : name;
}

/** `text` with its first letter a capital, as a sentence starts. */
export function sentenceStart(text: string, uiLocale: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(uiLocale) + text.slice(1) : text;
}
