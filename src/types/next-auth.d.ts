import type { DefaultSession } from "next-auth";

// What the session carries: the user's id, email and name, and when it
// expires. The session callback in src/auth.ts answers exactly this.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
    };
    expires: DefaultSession["expires"];
  }
}
