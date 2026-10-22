"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useContentLang } from "./CourseText";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  VideoContent,
  VideoCue,
  VideoCaptionTrack,
} from "@/lib/cms/types";
import {
  dueCue,
  sortCues,
  formatTimecode,
  parseYouTubeId,
  youTubeWatchUrl,
} from "@/lib/video";
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  Film,
  PlayCircle,
  ExternalLink,
} from "lucide-react";

/**
 * Interactive video. Plays an uploaded file / direct URL (native <video>) or a
 * YouTube video, and — if the block has cues — pauses at each cue's timestamp
 * to pop up a question. Answering (or skipping) resumes playback. Formative:
 * no grade, just a nudge to stay engaged, like the in-course checks.
 *
 * The two playback engines (native, YouTube) are separate child components so
 * each owns its own effect; both report time up and expose pause/play via refs.
 *
 * Release 2 (spec 5.9): in a narrow player (under 480 px, a phone) the
 * question is shown below the video instead of over it — squeezed into the
 * frame, its answers didn't fit (consortium point 5). Focus goes to the
 * question when it opens and back to the video when it closes.
 *
 * Release 3 (D91, spec 10.2): nothing from YouTube loads until the viewer
 * asks. A YouTube video shows a gate instead — what playing it sends to
 * YouTube, the privacy notice, "Play video (loads YouTube)" and "Watch on
 * youtube.com" — over a neutral placeholder (no thumbnail: that would be a
 * request to Google). Its text and buttons sit inside the 16:9 box only
 * when the player is at least NARROW_PLAYER_PX wide and the reading-help
 * text size is the default (gateFits); otherwise below it, in the page's
 * flow, where nothing is clipped. Pressing play loads the YouTube player
 * from youtube-nocookie.com (youTubePlayerOptions) and moves focus to a
 * status line that stays put; it is never moved into YouTube's frame. If
 * the video can't be embedded, the status line says so, with the watch
 * link. The choice isn't remembered: each video asks again. A file on
 * another host (`external`, stored before Release 3) is never loaded in
 * the page: it is offered as a link out. Continue never waits on a video.
 */

/** Below this width (px) the question goes under the video, not over it. */
export const NARROW_PLAYER_PX = 480;

/**
 * Do the gate's text and buttons fit inside the 16:9 box? Only in a player
 * at least NARROW_PLAYER_PX wide, with the reading-help text size at its
 * default (`fontSize`, html[data-font-size]: lg and xl make text up to
 * 1.25 times larger). Until the player has been measured they go below.
 */
export function gateFits(width: number | null, fontSize: string | null | undefined): boolean {
  return width !== null && width >= NARROW_PLAYER_PX && (!fontSize || fontSize === "normal");
}

/** Where the YouTube gate stands: before the press, loading after it, or failed. */
export type YouTubeGateState = "gate" | "loading" | "failed";

/**
 * The gate's state for the video now shown. A press is for the video it
 * was made for (`videoId`): any other video, as when the editor's live
 * preview keeps its player while the link changes, is back at the gate.
 */
export function gateStateFor(
  pressed: { videoId: string | null; state: YouTubeGateState },
  videoId: string | null
): YouTubeGateState {
  return videoId !== null && pressed.videoId === videoId ? pressed.state : "gate";
}

/** The YouTube player, once the viewer has asked for it: privacy-enhanced host, starting at once. */
export function youTubePlayerOptions(videoId: string, events: Record<string, (event: { data?: unknown }) => void>) {
  return {
    host: "https://www.youtube-nocookie.com",
    videoId,
    playerVars: { rel: 0, playsinline: 1, autoplay: 1 },
    events,
  };
}
export function InteractiveVideoPlayer({
  video,
  onCueAnswered,
}: {
  video: VideoContent;
  /** Fired when a cue is answered — for optional persistence. */
  onCueAnswered?: (cueId: string, correct: boolean) => void;
}) {
  const t = useTranslations("video");
  const lang = useContentLang();
  const cues = React.useMemo(() => sortCues(video.cues ?? []), [video.cues]);

  const [answered, setAnswered] = React.useState<string[]>([]);
  const [activeCue, setActiveCue] = React.useState<VideoCue | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);

  // How wide the player is: under NARROW_PLAYER_PX the question goes below,
  // and so do the gate's text and buttons (also with larger reading-help
  // text, which can change while the page is open).
  const sectionRef = React.useRef<HTMLElement>(null);
  const [narrow, setNarrow] = React.useState(false);
  const [width, setWidth] = React.useState<number | null>(null);
  const [fontSize, setFontSize] = React.useState<string | null>(null);
  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < NARROW_PLAYER_PX);
      setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    const html = document.documentElement;
    const read = () => setFontSize(html.getAttribute("data-font-size"));
    read();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(read);
    observer.observe(html, { attributes: true, attributeFilter: ["data-font-size"] });
    return () => observer.disconnect();
  }, []);

  // The YouTube gate: nothing from YouTube until the viewer presses play,
  // and each video asks again: the press is kept with its video's id, and
  // forgotten once another video is shown (coming back to the first asks
  // again too). A YouTube link plays behind the gate, whatever provider a
  // row stored before Release 3 names.
  const ytId = parseYouTubeId(video.src);
  const [ytPressed, setYtPressed] = React.useState<{ videoId: string | null; state: YouTubeGateState }>({
    videoId: null,
    state: "gate",
  });
  if (ytPressed.videoId !== null && ytPressed.videoId !== ytId) {
    setYtPressed({ videoId: null, state: "gate" });
  }
  const ytState = gateStateFor(ytPressed, ytId);
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const playYouTube = () => {
    setYtPressed({ videoId: ytId, state: "loading" });
    // The status line stays where it is, so focus waits there (never in
    // YouTube's frame) while the player loads.
    window.setTimeout(() => statusRef.current?.focus(), 0);
  };
  const youTubeFailed = React.useCallback(
    () => setYtPressed((p) => ({ ...p, state: "failed" })),
    [setYtPressed]
  );

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
      // Focus back on the video, whose button went with the question, and
      // resume once the question has gone.
      sectionRef.current?.querySelector<HTMLElement>("video, iframe")?.focus();
      window.setTimeout(() => playRef.current(), 0);
    },
    [onCueAnswered]
  );

  // Anything else from another host is a link out.
  const external = !ytId && (video.provider === "youtube" || video.external === true);
  const inside = gateFits(width, fontSize);

  return (
    <section
      ref={sectionRef}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
      aria-label={video.title ?? t("regionLabel")}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <Film className="h-4 w-4 text-[var(--accent)]" />
        {/* The title is course text; the fallback is the player's own word. */}
        <p lang={video.title ? lang : undefined} className="text-sm font-semibold flex-1 truncate">
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
        {ytId && ytState === "gate" ? (
          <GatePlaceholder>
            {inside ? <YouTubeGate videoId={ytId} onPlay={playYouTube} inside /> : null}
          </GatePlaceholder>
        ) : ytId ? (
          <YouTubeEngine
            videoId={ytId}
            onTime={handleTime}
            onDuration={setDuration}
            onError={youTubeFailed}
            pauseRef={pauseRef}
            playRef={playRef}
          />
        ) : external ? (
          <GatePlaceholder>
            {inside ? <ExternalVideo src={video.src} inside /> : null}
          </GatePlaceholder>
        ) : (
          <NativeEngine
            src={video.src}
            poster={video.poster}
            captions={video.captions}
            onTime={handleTime}
            onDuration={setDuration}
            pauseRef={pauseRef}
            playRef={playRef}
            unsupportedLabel={t("unsupported")}
          />
        )}

        {activeCue && !narrow ? (
          <QuizOverlay
            key={activeCue.id}
            cue={activeCue}
            onResolve={resolveCue}
          />
        ) : null}
      </div>

      {ytId && ytState === "gate" && !inside ? (
        <YouTubeGate videoId={ytId} onPlay={playYouTube} />
      ) : null}
      {external && !inside ? <ExternalVideo src={video.src} /> : null}
      {ytId ? <VideoStatus ref={statusRef} state={ytState} videoId={ytId} /> : null}

      {activeCue && narrow ? (
        <QuizOverlay
          key={activeCue.id}
          cue={activeCue}
          onResolve={resolveCue}
          below
        />
      ) : null}

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
        <p lang={lang} className="px-4 pb-3 text-xs text-[var(--muted-foreground)]">
          {video.caption}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------- Click-to-load gate ------------------------- */

/** The 16:9 box before anything loads: a neutral placeholder, never a thumbnail. */
function GatePlaceholder({ children }: { children?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-muted)]">
      {children ?? <Film className="h-10 w-10 text-[var(--muted-foreground)]" aria-hidden />}
    </div>
  );
}

/**
 * What playing a YouTube video sends to YouTube, the privacy notice, the
 * button that loads it and the watch link: inside the 16:9 box (`inside`)
 * or below it, in the page's flow.
 */
export function YouTubeGate({
  videoId,
  onPlay,
  inside = false,
}: {
  videoId: string;
  onPlay: () => void;
  inside?: boolean;
}) {
  const t = useTranslations("video.youtubeGate");
  return (
    <div
      className={
        inside
          ? "flex max-h-full w-full flex-col items-center justify-center gap-2 overflow-y-auto p-4 text-center"
          : "border-t border-[var(--border)] p-4"
      }
      data-testid="youtube-gate"
    >
      <p className="text-sm">{t("body")}</p>
      <p className="text-sm">
        {/* At least 24 px high: in English it is one short line (WCAG 2.5.8). */}
        <Link href="/legal/privacy" className="inline-flex min-h-6 items-center text-[var(--accent)] underline underline-offset-2">
          {t("privacyLink")}
        </Link>
      </p>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${inside ? "justify-center" : ""}`}>
        {/* Wraps on a phone with large text rather than running off the page. */}
        <Button size="sm" onClick={onPlay} className="h-auto min-h-9 whitespace-normal py-1.5 text-left">
          <PlayCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
          {t("play")}
        </Button>
        <WatchLink videoId={videoId} />
      </div>
    </div>
  );
}

/** "Watch on youtube.com": the video's watch page, in a new tab. */
function WatchLink({ videoId }: { videoId: string }) {
  const t = useTranslations("video.youtubeGate");
  return (
    <a
      href={youTubeWatchUrl(videoId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-[var(--accent)] underline underline-offset-2"
    >
      <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      {t("watchOn")}
    </a>
  );
}

/**
 * The line focus moves to when the viewer presses play: there from the
 * first render, so it never moves, and announced as it changes. Says the
 * video is loading, or that it can't be played here, with the watch link.
 */
export const VideoStatus = React.forwardRef<
  HTMLParagraphElement,
  { state: YouTubeGateState; videoId: string }
>(function VideoStatus({ state, videoId }, ref) {
  const t = useTranslations("video.youtubeGate");
  return (
    <p
      ref={ref}
      role="status"
      tabIndex={-1}
      className="px-4 py-2 text-sm outline-none empty:hidden focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {state === "loading" ? t("loading") : null}
      {state === "failed" ? (
        <>
          {t("failed")} <WatchLink videoId={videoId} />
        </>
      ) : null}
    </p>
  );
});

/** A file on another host (stored before Release 3): a link out, never loaded in the page. */
export function ExternalVideo({ src, inside = false }: { src: string; inside?: boolean }) {
  const t = useTranslations("video.external");
  return (
    <div
      className={inside ? "flex flex-col items-center gap-2 p-4 text-center" : "border-t border-[var(--border)] p-4"}
    >
      <p className="text-sm">{t("body")}</p>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-[var(--accent)] underline underline-offset-2"
      >
        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        {t("open")}
      </a>
    </div>
  );
}

/* ---------------------------- Quiz overlay ---------------------------- */

/**
 * The question at a cue: over the paused video, or (`below`, a narrow
 * player) under it — there not modal, as the page around it stays usable.
 * The question, its options and its explanation are course text, marked
 * with the course's language when it isn't the page's (useContentLang).
 */
export function QuizOverlay({
  cue,
  onResolve,
  below = false,
}: {
  cue: VideoCue;
  onResolve: (cueId: string, correct: boolean | null) => void;
  below?: boolean;
}) {
  const t = useTranslations("video");
  const [choice, setChoice] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const uid = React.useId();
  const headingId = `${uid}-question`;
  const lang = useContentLang();

  React.useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const correct = choice === cue.correctOptionId;

  return (
    <div
      role="dialog"
      aria-modal={below ? undefined : "true"}
      aria-labelledby={headingId}
      className={
        below
          ? "border-t border-[var(--border)] p-4"
          : "absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      }
    >
      <div className={below ? "w-full" : "w-full max-w-lg rounded-xl bg-[var(--surface)] p-5 shadow-2xl my-auto"}>
        <p className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5" />
          {t("quickQuestion")}
        </p>
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          lang={lang}
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
                  name={`${uid}-answer`}
                  value={o.id}
                  checked={isChoice}
                  onChange={() => setChoice(o.id)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span lang={lang} className="flex-1">{o.text}</span>
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
              <p lang={lang} className="mt-1 text-sm text-[var(--muted-foreground)]">
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

/** The part of a <video> element the native engine follows. */
type FollowedVideo = Pick<
  HTMLVideoElement,
  "currentTime" | "duration" | "readyState" | "addEventListener" | "removeEventListener"
>;

/**
 * Reports a native video's time and length; returns what stops it. A video
 * the page arrives with (server-rendered) starts loading before the page's
 * scripts run, so its length can be known — and "loadedmetadata" already
 * past — by the time this listens: it is then read at once (readyState 1 is
 * HAVE_METADATA). Without that the player never learned the length, and
 * the questions' place on the timeline never showed.
 */
export function followNativeVideo(
  el: FollowedVideo,
  onTime: (t: number) => void,
  onDuration: (d: number) => void
): () => void {
  const onTimeUpdate = () => onTime(el.currentTime);
  const onMeta = () => onDuration(el.duration || 0);
  el.addEventListener("timeupdate", onTimeUpdate);
  el.addEventListener("seeked", onTimeUpdate);
  el.addEventListener("loadedmetadata", onMeta);
  if (el.readyState >= 1) onMeta();
  return () => {
    el.removeEventListener("timeupdate", onTimeUpdate);
    el.removeEventListener("seeked", onTimeUpdate);
    el.removeEventListener("loadedmetadata", onMeta);
  };
}

function NativeEngine({
  src,
  poster,
  captions,
  onTime,
  onDuration,
  pauseRef,
  playRef,
  unsupportedLabel,
}: {
  src: string;
  poster?: string;
  captions?: VideoCaptionTrack[];
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
    return followNativeVideo(el, onTime, onDuration);
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
      crossOrigin="anonymous"
    >
      {(captions ?? []).map((c) => (
        <track
          key={`${c.lang}-${c.label}`}
          kind="captions"
          src={c.src}
          srcLang={c.lang}
          label={c.label}
          default={c.default}
        />
      ))}
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

/**
 * The YouTube player: mounted only after the viewer pressed play behind
 * the gate, so the API script and the frame load only then, from
 * youtube-nocookie.com. Its errors (embedding switched off, 150 or 153)
 * go to the status line.
 */
function YouTubeEngine({
  videoId,
  onTime,
  onDuration,
  onError,
  pauseRef,
  playRef,
}: {
  videoId: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  onError: () => void;
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
      player = new window.YT.Player(
        hostRef.current,
        youTubePlayerOptions(videoId, {
          onReady: () => {
            pauseRef.current = () => player.pauseVideo?.();
            playRef.current = () => player.playVideo?.();
            onDuration(player.getDuration?.() || 0);
            poll = setInterval(() => {
              if (player.getCurrentTime) onTime(player.getCurrentTime());
            }, 250);
          },
          onError: () => onError(),
        })
      );
    });

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      player?.destroy?.();
    };
  }, [videoId, onTime, onDuration, onError, pauseRef, playRef]);

  return <div ref={hostRef} className="h-full w-full" />;
}
