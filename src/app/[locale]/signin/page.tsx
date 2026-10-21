import { setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/auth/SignInForm";
import { demoLoginAllowed } from "@/lib/demo-gate";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { locale } = await params;
  const { callbackUrl } = await searchParams;
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
    />
  );
}
