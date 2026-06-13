import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { DemoStateProvider } from "@/store/demo-state";
import { AccessibilityProvider } from "@/components/a11y/AccessibilityProvider";
import { ProjectThemeProvider } from "@/components/ProjectThemeProvider";
import { Analytics } from "@/components/Analytics";
import "../globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "greek"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SEQ Elevate",
  description:
    "SEQ Elevate — a learning journey for skills that matter. Created and Powered by SENIC.",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen flex flex-col">
        <Analytics />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ProjectThemeProvider>
            <AccessibilityProvider>
              <DemoStateProvider>{children}</DemoStateProvider>
            </AccessibilityProvider>
          </ProjectThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
