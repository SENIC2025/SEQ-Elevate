import { assertDevPagesAllowed } from "@/lib/dev-pages";

/** Developer-only pages; each page also checks (see assertDevPagesAllowed). */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  assertDevPagesAllowed();
  return children;
}
