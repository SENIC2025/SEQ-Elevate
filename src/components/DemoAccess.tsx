"use client";

import * as React from "react";
import { demoSignIn } from "@/app/actions/demo";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  LogIn,
  Loader2,
  AlertTriangle,
  KeyRound,
  Info,
} from "lucide-react";

interface ProfileCard {
  id: string;
  name: string;
  roleLabel: string;
  blurb: string;
}

export function DemoAccess({
  profiles,
  locale,
  enabled,
}: {
  profiles: ProfileCard[];
  locale: string;
  enabled: boolean;
}) {
  const [code, setCode] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function enter(id: string) {
    if (!code.trim()) {
      setError("Enter the access code first.");
      return;
    }
    setPending(id);
    setError(null);
    const res = await demoSignIn(id, code);
    if (res.ok) {
      // Full reload so the new session cookie is picked up server-side.
      window.location.assign(`/${locale}${res.landing}`);
    } else {
      setError(
        res.error === "bad-code"
          ? "That access code isn't right."
          : res.error === "disabled"
            ? "Demo access is turned off for this site."
            : "Couldn't sign in — please try again."
      );
      setPending(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
          <Sparkles className="h-4 w-4" />
        </span>
        SEQ Elevate
        <Badge variant="primary" className="ml-1 text-[10px]">
          Demo access
        </Badge>
      </div>

      <h1 className="mt-5 text-2xl sm:text-3xl font-bold tracking-tight">
        Explore the platform
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)] max-w-xl">
        Pick a profile to sign straight in as that role — no account or email
        needed. Everything here is a working demo with placeholder content.
      </p>

      {/* Access code */}
      <div className="mt-5 max-w-sm">
        <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1 flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          Access code
        </label>
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="Enter the code you were given"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          disabled={!enabled}
        />
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)] flex items-center gap-1.5" role="alert">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </p>
      ) : null}

      {/* Profiles */}
      <div className="mt-6 grid sm:grid-cols-2 gap-3">
        {profiles.map((p) => (
          <Card key={p.id}>
            <CardContent className="p-4 flex flex-col h-full">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{p.name}</p>
                <Badge variant="accent" className="text-[10px]">
                  {p.roleLabel}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)] flex-1">
                {p.blurb}
              </p>
              <Button
                size="sm"
                className="mt-3 self-start"
                disabled={!enabled || pending !== null}
                onClick={() => enter(p.id)}
              >
                {pending === p.id ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Enter as {p.name}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-xs text-[var(--muted-foreground)] flex gap-2.5">
        <Info className="h-4 w-4 text-[var(--accent)] flex-shrink-0 mt-0.5" />
        <p>
          This one-click access is a demo convenience for showcasing the
          platform. It&apos;s code-protected and uses placeholder data; it is
          disabled on the real production site.
        </p>
      </div>
    </div>
  );
}
