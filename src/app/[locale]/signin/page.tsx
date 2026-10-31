import { setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/auth/SignInForm";
import { demoLoginAllowed } from "@/lib/demo-gate";
import { SIGN_IN_EMAIL_LIMITED } from "@/lib/signin-result";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { callbackUrl, error } = await searchParams;
  setRequestLocale(locale);
  // Demo link only where demo sign-in is allowed (D98); elsewhere it would be
  // a dead end.
  const demoEnabled = demoLoginAllowed();
  // Land on "Your workspaces"; it forwards single-workspace users (most
  // learners) straight to their space, and shows staff every workspace.
  return (
    <SignInForm
      callbackUrl={callbackUrl ?? `/${locale}`}
      demoEnabled={demoEnabled}
      // Auth.js sends a request over a sign-in email limit here (D116).
      initialError={error === SIGN_IN_EMAIL_LIMITED ? "rate-limited" : null}
    />
  );
}
