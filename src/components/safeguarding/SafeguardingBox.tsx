import { getViewer } from "@/lib/scope";
import { loadSafeguarding } from "@/lib/safeguarding.server";
import { contactsFor } from "@/lib/safeguarding";
import { isCountry } from "@/lib/countries";
import { SafeguardingBoxView } from "./SafeguardingBoxView";

/**
 * Who to talk to when something is wrong (D93, spec 11.3): placed after
 * `</main>` on the learner and account pages and on /welcome, so a page's
 * main content (and Release 2's recorded walk, which reads <main>) is
 * unchanged. A server component: it reads the contacts an ADMIN saved
 * (Project.safeguarding) and the viewer's country (their profile's), and
 * shows the contacts of that country; with no country (a guest, a profile
 * not yet complete), every country's. 112 is in code and always shows; a
 * failed read shows it with the fallback line, never nothing.
 */
export async function SafeguardingBox() {
  const [viewer, setting] = await Promise.all([getViewer(), loadSafeguarding()]);
  const country = isCountry(viewer.profile?.country) ? viewer.profile.country : null;
  return <SafeguardingBoxView groups={contactsFor(setting, country)} />;
}
