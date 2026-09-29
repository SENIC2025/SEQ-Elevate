"use client";

import type { Locale } from "@/lib/cms/types";

/**
 * Stand-in with the agreed props (design §1.13) so the course grid builds on
 * its own branch. The real form is WS-C's file at this same path; when the
 * branches merge, WS-C's version replaces this one entirely.
 */
export function NewCourseForm(props: {
  locale: Locale;
  onCreated?: (slug: string) => void;
}) {
  void props;
  return null;
}
