import { setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/auth/SignInForm";

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
  return <SignInForm callbackUrl={callbackUrl ?? `/${locale}`} />;
}
