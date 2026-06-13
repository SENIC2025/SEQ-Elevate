import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { DemoStateProvider } from "@/store/demo-state";
import { AccessibilityProvider } from "@/components/a11y/AccessibilityProvider";
import { ProjectThemeProvider } from "@/components/ProjectThemeProvider";
import { SessionProviderWrapper } from "@/components/SessionProviderWrapper";
import { Analytics } from "@/components/Analytics";
import "../globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "greek"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.AUTH_URL ?? "https://seq-elevate-demo.vercel.app"
  ),
  title: {
    default: "SEQ Elevate",
    template: "%s · SEQ Elevate",
  },
  description:
    "SEQ Elevate — a learning journey for skills that matter. Created and Powered by SENIC.",
  applicationName: "SEQ Elevate",
  appleWebApp: {
    capable: true,
    title: "SEQ Elevate",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "SEQ Elevate",
    description:
      "A learning journey for skills that matter — for life, work and what comes next.",
    siteName: "SEQ Elevate",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#cad12c",
  width: "device-width",
  initialScale: 1,
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
  const t = await getTranslations("system");

  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen flex flex-col">
        <a href="#main-content" className="skip-link">
          {t("skipToContent")}
        </a>
        <Analytics />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SessionProviderWrapper>
            <ProjectThemeProvider>
              <AccessibilityProvider>
                <DemoStateProvider>{children}</DemoStateProvider>
              </AccessibilityProvider>
            </ProjectThemeProvider>
          </SessionProviderWrapper>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
