import { useCallback, useEffect, useRef } from "react";
import { recordStageTime } from "@/app/actions/telemetry";

/**
 * Tracks active time on the current stage and flushes it to the server when
 * the stage changes, the tab is hidden, or the page unloads. Time only counts
 * while the tab is visible (so an idle background tab doesn't inflate it).
 * Only records for `enabled` (authenticated) learners.
 */
export function useStageTimer(
  courseSlug: string,
  stage: string,
  enabled: boolean
) {
  const startRef = useRef<number | null>(null);
  const accumRef = useRef(0);
  const stageRef = useRef(stage);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const flush = useCallback(() => {
    if (startRef.current != null) {
      accumRef.current += Date.now() - startRef.current;
      startRef.current = null;
    }
    const seconds = Math.round(accumRef.current / 1000);
    accumRef.current = 0;
    if (enabledRef.current && seconds > 0) {
      void recordStageTime({ courseSlug, stage: stageRef.current, seconds });
    }
  }, [courseSlug]);

  // Start timing the active stage; flush the previous one on change/unmount.
  useEffect(() => {
    stageRef.current = stage;
    startRef.current = Date.now();
    accumRef.current = 0;
    return () => flush();
  }, [stage, flush]);

  // Pause while the tab is hidden; flush on page hide (covers tab close).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (startRef.current != null) {
          accumRef.current += Date.now() - startRef.current;
          startRef.current = null;
        }
      } else if (startRef.current == null) {
        startRef.current = Date.now();
      }
    };
    const onHide = () => flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);
}
