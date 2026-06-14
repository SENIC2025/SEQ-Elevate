"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { VideoContent, VideoCue } from "@/lib/cms/types";
import { dueCue, sortCues, formatTimecode, parseYouTubeId } from "@/lib/video";
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  Film,
  PlayCircle,
} from "lucide-react";

/**
 * Interactive video. Plays an uploaded file / direct URL (native <video>) or a
 * YouTube video, and — if the block has cues — pauses at each cue's timestamp
 * to pop up a question. Answering (or skipping) resumes playback. Formative:
 * no grade, just a nudge to stay engaged, like the in-course checks.
 *
 * The two playback engines (native, YouTube) are separate child components so
 * each owns its own effect; both report time up and expose pause/play via refs.
 */
export function InteractiveVideoPlayer({
  video,
  onCueAnswered,
}: {
  video: VideoContent;
  /** Fired when a cue is answered — for optional persistence. */
  onCueAnswered?: (cueId: string, correct: boolean) => void;
}) {
  const t = useTranslations("video");
  const cues = React.useMemo(() => sortCues(video.cues ?? []), [video.cues]);

  const [answered, setAnswered] = React.useState<string[]>([]);
  const [activeCue, setActiveCue] = React.useState<VideoCue | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);

  // Engine controls, set by whichever child engine mounts.
  const pauseRef = React.useRef<() => void>(() => {});
  const playRef = React.useRef<() => void>(() => {});

  // Mirror the latest values into refs so the time callback can read them
  // without changing identity (which would re-subscribe the engine — and
  // recreate the YouTube player — on every answer).
  const answeredRef = React.useRef<string[]>([]);
  const askingRef = React.useRef(false);
  React.useEffect(() => {
    answeredRef.current = answered;
  }, [answered]);
  React.useEffect(() => {
    askingRef.current = activeCue !== null;
  }, [activeCue]);

  const handleTime = React.useCallback(
    (time: number) => {
      setCurrentTime(time);
      if (askingRef.current) return; // a question is already up
      const due = dueCue(cues, time, answeredRef.current);
      if (due) {
        setActiveCue(due);
        pauseRef.current();
      }
    },
    [cues]
  );

  const resolveCue = React.useCallback(
    (cueId: string, correct: boolean | null) => {
      setAnswered((a) => (a.includes(cueId) ? a : [...a, cueId]));
      setActiveCue(null);
      if (correct !== null) onCueAnswered?.(cueId, correct);
      // Resume after the overlay unmounts.
      window.setTimeout(() => playRef.current(), 0);
    },
    [onCueAnswered]
  );

  const ytId = video.provider === "youtube" ? parseYouTubeId(video.src) : null;

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
      aria-label={video.title ?? t("regionLabel")}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <Film className="h-4 w-4 text-[var(--accent)]" />
        <p className="text-sm font-semibold flex-1 truncate">
          {video.title ?? t("regionLabel")}
        </p>
        {cues.length > 0 ? (
          <Badge variant="accent" className="text-[10px]">
            <HelpCircle className="h-3 w-3" />
            {t("interactiveBadge", { count: cues.length })}
          </Badge>
        ) : null}
      </div>

      <div className="relative bg-black aspect-video">
        {video.provider === "youtube" && ytId ? (
          <YouTubeEngine
            videoId={ytId}
            onTime={handleTime}
            onDuration={setDuration}
            pauseRef={pauseRef}
            playRef={playRef}
          />
        ) : (
          <NativeEngine
            src={video.src}
            poster={video.poster}
            onTime={handleTime}
            onDuration={setDuration}
            pauseRef={pauseRef}
            playRef={playRef}
            unsupportedLabel={t("unsupported")}
          />
        )}

        {activeCue ? (
          <QuizOverlay
            key={activeCue.id}
            cue={activeCue}
            onResolve={resolveCue}
          />
        ) : null}
      </div>

      {/* Cue timeline — shows where the questions are */}
      {cues.length > 0 && duration > 0 ? (
        <div className="px-4 py-3">
          <div
            className="relative h-1.5 rounded-full bg-[var(--surface-muted)]"
            aria-hidden="true"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]/40"
              style={{
                width: `${Math.min(100, (currentTime / duration) * 100)}%`,
              }}
            />
            {cues.map((c) => (
              <span
                key={c.id}
                title={`${t("questionAt", { time: formatTimecode(c.atSeconds) })}`}
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] ${
                  answered.includes(c.id)
                    ? "bg-[var(--success)]"
                    : "bg-[var(--accent)]"
                }`}
                style={{
                  left: `${Math.min(100, (c.atSeconds / duration) * 100)}%`,
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)] flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5 text-[var(--accent)]" />
            {t("timelineHint")}
          </p>
        </div>
      ) : null}

      {video.caption ? (
        <p className="px-4 pb-3 text-xs text-[var(--muted-foreground)]">
          {video.caption}
        </p>
      ) : null}
    </section>
  );
}

/* ---------------------------- Quiz overlay ---------------------------- */

function QuizOverlay({
  cue,
  onResolve,
}: {
  cue: VideoCue;
  onResolve: (cueId: string, correct: boolean | null) => void;
}) {
  const t = useTranslations("video");
  const [choice, setChoice] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const correct = choice === cue.correctOptionId;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cue-question"
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-xl bg-[var(--surface)] p-5 shadow-2xl my-auto">
        <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5" />
          {t("quickQuestion")}
        </p>
        <h3
          id="cue-question"
          ref={headingRef}
          tabIndex={-1}
          className="mt-1 text-lg font-bold outline-none"
        >
          {cue.question}
        </h3>

        <fieldset className="mt-4 space-y-2" disabled={submitted}>
          <legend className="sr-only">{t("chooseAnswer")}</legend>
          {cue.options.map((o) => {
            const isChoice = choice === o.id;
            const isCorrect = o.id === cue.correctOptionId;
            const showState = submitted && (isChoice || isCorrect);
            return (
              <label
                key={o.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                  showState && isCorrect
                    ? "border-[var(--success)] bg-[var(--success)]/10"
                    : showState && isChoice && !isCorrect
                      ? "border-[var(--danger)] bg-[var(--danger)]/10"
                      : isChoice
                        ? "border-[var(--accent)] bg-[var(--accent)]/10"
                        : "border-[var(--border)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <input
                  type="radio"
                  name="cue-answer"
                  value={o.id}
                  checked={isChoice}
                  onChange={() => setChoice(o.id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="flex-1">{o.text}</span>
                {showState && isCorrect ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                ) : showState && isChoice && !isCorrect ? (
                  <XCircle className="h-4 w-4 text-[var(--danger)]" />
                ) : null}
              </label>
            );
          })}
        </fieldset>

        {submitted ? (
          <div
            className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3"
            role="status"
          >
            <p
              className={`text-sm font-semibold flex items-center gap-1.5 ${
                correct ? "text-[var(--success)]" : "text-[var(--foreground)]"
              }`}
            >
              {correct ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4 text-[var(--danger)]" />
              )}
              {correct ? t("correct") : t("notQuite")}
            </p>
            {cue.explanation ? (
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {cue.explanation}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          {!submitted ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onResolve(cue.id, null)}
              >
                {t("skip")}
              </Button>
              <Button
                size="sm"
                disabled={choice === null}
                onClick={() => setSubmitted(true)}
              >
                {t("submit")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => onResolve(cue.id, correct)}
            >
              <PlayCircle className="h-4 w-4" />
              {t("continueWatching")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Native engine ---------------------------- */

function NativeEngine({
  src,
  poster,
  onTime,
  onDuration,
  pauseRef,
  playRef,
  unsupportedLabel,
}: {
  src: string;
  poster?: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  pauseRef: React.RefObject<() => void>;
  playRef: React.RefObject<() => void>;
  unsupportedLabel: string;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    pauseRef.current = () => el.pause();
    playRef.current = () => {
      void el.play().catch(() => {});
    };
    const onTimeUpdate = () => onTime(el.currentTime);
    const onMeta = () => onDuration(el.duration || 0);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeked", onTimeUpdate);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeked", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [onTime, onDuration, pauseRef, playRef]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      className="h-full w-full"
      data-testid="lesson-video"
    >
      {unsupportedLabel}
    </video>
  );
}

/* ---------------------------- YouTube engine ---------------------------- */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

function YouTubeEngine({
  videoId,
  onTime,
  onDuration,
  pauseRef,
  playRef,
}: {
  videoId: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  pauseRef: React.RefObject<() => void>;
  playRef: React.RefObject<() => void>;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let player: any;
    let poll: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      player = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            pauseRef.current = () => player.pauseVideo?.();
            playRef.current = () => player.playVideo?.();
            onDuration(player.getDuration?.() || 0);
            poll = setInterval(() => {
              if (player.getCurrentTime) onTime(player.getCurrentTime());
            }, 250);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      player?.destroy?.();
    };
  }, [videoId, onTime, onDuration, pauseRef, playRef]);

  return <div ref={hostRef} className="h-full w-full" />;
}
