/**
 * The address to ask for a page's React Server Components payload with a
 * bare `RSC: 1` request (no router headers), as the specs do: with an empty
 * `_rsc` search parameter. From Next 16.4 the server checks that `_rsc`
 * matches the router headers sent (a hash of them; empty when there are
 * none) and answers any other request with a 307 to the address that has
 * it, which the specs' `maxRedirects: 0` would read as a redirect away.
 * The browser's own router always sends it.
 */
export function rscPath(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}_rsc`;
}
