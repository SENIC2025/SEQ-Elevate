"use client";

/**
 * In-app component storybook / design-system gallery.
 *
 * Renders every UI primitive and key composite in the real theme,
 * switchable across locales and accessibility modes. This is the
 * canonical visual reference for the design system — it can never
 * drift from the actual components because it imports them directly.
 *
 * Route: /[locale]/dev/storybook  (unlinked from user flows; dev reference)
 * See STORYBOOK.md for the narrative companion.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { StageBreadcrumb } from "@/components/course/StageBreadcrumb";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AccessibilityToolbar } from "@/components/a11y/AccessibilityToolbar";
import { STAGES, type Stage } from "@/data/course";
import {
  Sparkles,
  ArrowRight,
  Check,
  Trophy,
  Palette,
  Type as TypeIcon,
  Component as ComponentIcon,
  Layers,
} from "lucide-react";

const PALETTE = [
  { name: "primary", label: "Lime · brand surface", fg: "var(--primary-foreground)" },
  { name: "accent", label: "Purple · accent/text", fg: "#fff" },
  { name: "tertiary", label: "Rose · highlight", fg: "#fff" },
  { name: "foreground", label: "Text", fg: "#fff" },
  { name: "muted-foreground", label: "Muted text", fg: "#fff" },
  { name: "background", label: "Page bg", fg: "var(--foreground)" },
  { name: "surface", label: "Card surface", fg: "var(--foreground)" },
  { name: "surface-muted", label: "Muted panel", fg: "var(--foreground)" },
  { name: "border", label: "Border", fg: "var(--foreground)" },
  { name: "success", label: "Success", fg: "#fff" },
  { name: "warning", label: "Warning", fg: "#fff" },
  { name: "danger", label: "Danger", fg: "#fff" },
];

const GRADIENTS = [
  { name: "Warm / sunset (logo)", from: "var(--warm-1)", via: "var(--warm-3)", to: "var(--warm-4)" },
  { name: "Cool / aurora (logo)", from: "var(--cool-1)", via: "var(--cool-3)", to: "var(--cool-4)" },
];

export function StorybookGallery() {
  const [breadcrumbStage, setBreadcrumbStage] = useState<Stage>("simulation");
  const [textValue, setTextValue] = useState("");

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="font-semibold leading-tight">Component Storybook</p>
              <p className="text-[10px] text-[var(--muted-foreground)] leading-tight">
                SEQ Elevate · live design-system reference
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <AccessibilityToolbar />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-12">
        <p className="text-sm text-[var(--muted-foreground)] max-w-2xl">
          Every primitive in the real theme. Switch language or toggle the
          accessibility modes (top right) to see components adapt live. This
          page imports the actual components — it cannot drift from production.
        </p>

        {/* ============ Tokens ============ */}
        <Section icon={<Palette className="h-5 w-5" />} title="Colour tokens" id="tokens">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {PALETTE.map((c) => (
              <div
                key={c.name}
                className="rounded-lg border border-[var(--border)] overflow-hidden"
              >
                <div
                  className="h-16 flex items-end p-2"
                  style={{ background: `var(--${c.name})`, color: c.fg }}
                >
                  <span className="text-[10px] font-mono">--{c.name}</span>
                </div>
                <div className="p-2 bg-[var(--surface)]">
                  <p className="text-xs font-medium">{c.label}</p>
                </div>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-semibold mt-6 mb-2">Logo gradients</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {GRADIENTS.map((g) => (
              <div
                key={g.name}
                className="h-20 rounded-lg border border-[var(--border)] flex items-end p-3 text-white text-xs font-medium"
                style={{
                  background: `linear-gradient(135deg, ${g.from}, ${g.via}, ${g.to})`,
                }}
              >
                {g.name}
              </div>
            ))}
          </div>
        </Section>

        {/* ============ Typography ============ */}
        <Section icon={<TypeIcon className="h-5 w-5" />} title="Typography" id="type">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">Heading 1 · 4xl bold</h1>
            <h2 className="text-2xl font-bold tracking-tight">Heading 2 · 2xl bold</h2>
            <h3 className="text-lg font-semibold">Heading 3 · lg semibold</h3>
            <p className="text-base">Body · base. The quick brown fox. Γρήγορη καφέ αλεπού. Schöne Grüße.</p>
            <p className="text-sm text-[var(--muted-foreground)]">Small muted · secondary text.</p>
            <p className="text-xs uppercase tracking-wider font-semibold text-[var(--accent)]">Eyebrow label · xs uppercase accent</p>
          </div>
        </Section>

        {/* ============ Buttons ============ */}
        <Section icon={<ComponentIcon className="h-5 w-5" />} title="Button" id="button">
          <div className="space-y-4">
            <Row label="Variants">
              <Button variant="primary">Primary</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </Row>
            <Row label="Sizes">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="icon"><ArrowRight className="h-4 w-4" /></Button>
            </Row>
            <Row label="With icon / disabled">
              <Button>Continue <ArrowRight className="h-4 w-4" /></Button>
              <Button disabled>Disabled</Button>
            </Row>
          </div>
        </Section>

        {/* ============ Badge ============ */}
        <Section icon={<ComponentIcon className="h-5 w-5" />} title="Badge" id="badge">
          <Row label="Variants">
            <Badge>Default</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="success"><Check className="h-3 w-3" /> Success</Badge>
            <Badge variant="muted">Muted</Badge>
          </Row>
        </Section>

        {/* ============ Progress ============ */}
        <Section icon={<ComponentIcon className="h-5 w-5" />} title="Progress" id="progress">
          <div className="space-y-4 max-w-md">
            <Progress value={20} label="Started" />
            <Progress value={57} label="Mid-course" />
            <Progress value={100} label="Complete" />
          </div>
        </Section>

        {/* ============ Card ============ */}
        <Section icon={<Layers className="h-5 w-5" />} title="Card" id="card">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>A short description sits under the title.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Card content area. The default surface container across the app.</p>
              </CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
                <Button size="sm" variant="outline">Secondary</Button>
              </CardFooter>
            </Card>
            <Card className="border-[var(--accent)]/30">
              <CardContent className="p-6">
                <Badge variant="accent" className="mb-2"><Sparkles className="h-3 w-3" /> Highlighted</Badge>
                <p className="text-sm">A card with an accent border, used for hero/CTA surfaces.</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ============ Textarea ============ */}
        <Section icon={<ComponentIcon className="h-5 w-5" />} title="Textarea" id="textarea">
          <div className="max-w-md">
            <label className="block text-sm font-medium mb-1.5">Reflection field</label>
            <Textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Type here — focus to see the ring…"
              rows={3}
            />
          </div>
        </Section>

        {/* ============ Stage breadcrumb ============ */}
        <Section icon={<Layers className="h-5 w-5" />} title="Stage breadcrumb (WP3 sequence)" id="breadcrumb">
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            The proof the pedagogy is enforced. Click a reachable stage to move the indicator.
          </p>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <StageBreadcrumb
              current={breadcrumbStage}
              completed={STAGES.slice(0, STAGES.indexOf(breadcrumbStage))}
              onJump={setBreadcrumbStage}
            />
          </div>
        </Section>

        {/* ============ Badge unlock preview ============ */}
        <Section icon={<Trophy className="h-5 w-5" />} title="Gamification · badge" id="badge-unlock">
          <div className="inline-flex items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-5 py-4">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg"
              style={{
                background: "linear-gradient(135deg, var(--warm-2), var(--warm-3), var(--warm-4))",
              }}
            >
              <Trophy className="h-7 w-7" />
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold">Badge unlocked</p>
              <p className="font-bold">Voice without edges</p>
              <p className="text-xs text-[var(--muted-foreground)]">Spoke up without escalating or shrinking</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">No leaderboards — per WP3 §10.</p>
        </Section>

        <footer className="border-t border-[var(--border)] pt-6 text-xs text-[var(--muted-foreground)]">
          SEQ Elevate component storybook · Created and Powered by SENIC · see STORYBOOK.md
        </footer>
      </main>
    </div>
  );
}

function Section({
  icon,
  title,
  id,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight mb-4 pb-2 border-b border-[var(--border)]">
        <span className="text-[var(--accent)]">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-2">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
