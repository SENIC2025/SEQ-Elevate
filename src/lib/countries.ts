/**
 * Release 3 (D72, Q24): the countries a person can take part from, in the
 * order the profile step offers them. GR is the country; "el" is the
 * language. Shared by the profile step, the country mapping and the
 * safeguarding contacts.
 *
 * Pure (type-only imports), so client components can use it too.
 */

import type { Country as DbCountry } from "@prisma/client";

export const COUNTRIES = ["DE", "CY", "BE", "GR", "OTHER"] as const;

export type Country = (typeof COUNTRIES)[number];

// The list and the database enum must be the same set: a country added to one
// and not the other fails type-checking here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameAsDatabase: Same<Country, DbCountry> = true;
void sameAsDatabase;

/** Is `value` one of the countries? */
export function isCountry(value: unknown): value is Country {
  return typeof value === "string" && (COUNTRIES as readonly string[]).includes(value);
}
