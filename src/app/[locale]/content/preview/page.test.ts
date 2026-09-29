import { describe, it, expect } from "vitest";
import Page from "./page";

const visit = (locale: string) => Page({ params: Promise.resolve({ locale }) });

describe("old /content/preview address", () => {
  it("permanently redirects to the authoring page in the same language", async () => {
    // permanentRedirect() throws Next's redirect signal; its digest carries
    // the target and the status code: NEXT_REDIRECT;<type>;<url>;308;
    await expect(visit("de")).rejects.toMatchObject({
      digest: expect.stringMatching(/;\/de\/content;308;/),
    });
  });

  it("is a 404 for anything that isn't one of our locales", async () => {
    await expect(visit("//evil.example")).rejects.toThrow(/;404$/);
  });
});
