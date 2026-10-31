import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The sign-in form's action (D116): the address is checked with the sign-in
 * rule before Auth.js is asked for anything, and Auth.js is asked for the
 * normalised address. Over a sign-in email limit, Auth.js sends the form to
 * the sign-in page with error=rate-limited; the action answers that to the
 * form instead, which says so in the page's language. Anything else Auth.js
 * answers (the "check your email" step, its error page) is followed as before.
 */

const signIn = vi.fn();
const redirect = vi.fn();
vi.mock("@/auth", () => ({ signIn, signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

const { signInWithEmail } = await import("./auth");

const form = (email: string, callbackUrl = "/de/admin") => {
  const data = new FormData();
  data.set("email", email);
  data.set("callbackUrl", callbackUrl);
  return data;
};

beforeEach(() => {
  signIn.mockReset();
  redirect.mockReset();
  signIn.mockResolvedValue("http://localhost:3000/api/auth/verify-request?provider=resend&type=email");
});

describe("signInWithEmail", () => {
  it("refuses an address the sign-in rule refuses, without asking Auth.js for anything", async () => {
    for (const email of [
      "victim@example.org﹫evil.example",
      "victim@example.org＠evil.example",
      "victim＠example.org",
      "jörg@example.org",
      "ana\u0007@example.org",
      "ana@localhost",
      "",
    ]) {
      await expect(signInWithEmail(form(email)), JSON.stringify(email)).resolves.toEqual({ error: "invalid-email" });
    }
    expect(signIn).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("asks Auth.js for the normalised address, and follows where Auth.js sends the form", async () => {
    await signInWithEmail(form("  Ana.Smith@Example.ORG ", "/de/admin"));
    expect(signIn).toHaveBeenCalledWith("resend", {
      email: "ana.smith@example.org",
      redirectTo: "/de/admin",
      redirect: false,
    });
    expect(redirect).toHaveBeenCalledWith("http://localhost:3000/api/auth/verify-request?provider=resend&type=email");
  });

  it("follows Auth.js's error page as before", async () => {
    signIn.mockResolvedValue("http://localhost:3000/api/auth/error?error=Configuration");
    await expect(signInWithEmail(form("ana@example.org"))).resolves.toBeUndefined();
    expect(redirect).toHaveBeenCalledWith("http://localhost:3000/api/auth/error?error=Configuration");
  });

  it("over a sign-in email limit, tells the form, which stays where it is", async () => {
    signIn.mockResolvedValue("http://localhost:3000/en/signin?error=rate-limited");
    await expect(signInWithEmail(form("ana@example.org"))).resolves.toEqual({ error: "rate-limited" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
