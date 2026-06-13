"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useDemoState } from "@/store/demo-state";
import type { CourseContent } from "@/lib/cms/types";
import { Award, Trophy, FileText, Home, Sparkles } from "lucide-react";

/**
 * Completion + badge unlock. Badge + completion copy come from the authored
 * course, so any course celebrates with its own badge.
 */
export function CompletionStage({ course }: { course: CourseContent }) {
  const t = useTranslations("coursePlayer");
  const { state, dispatch } = useDemoState();

  useEffect(() => {
    if (!state.course.completedAt) dispatch({ type: "completeCourse" });
    if (!state.badges.includes(course.badge.slug)) {
      dispatch({ type: "awardBadge", badge: course.badge.slug });
    }
  }, [dispatch, state.course.completedAt, state.badges, course.badge.slug]);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-10 text-center">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 14 }}
          className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[var(--warm-2)] via-[var(--warm-3)] to-[var(--warm-4)] text-white shadow-lg shadow-[var(--warm-3)]/40 relative"
        >
          <Trophy className="h-12 w-12" />
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3, type: "spring" }}
            className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-white text-[var(--warm-3)] shadow-md"
          >
            <Sparkles className="h-4 w-4" />
          </motion.span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-6 text-3xl font-bold tracking-tight"
        >
          {course.completion.title}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-3 max-w-lg mx-auto text-[var(--muted-foreground)]"
        >
          {course.completion.body}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-7 inline-flex items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-5 py-4"
        >
          <Award className="h-8 w-8 text-[var(--accent)]" />
          <div className="text-left">
            <p className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold">
              {t("badgeUnlocked")}
            </p>
            <p className="text-base font-bold">{course.badge.name}</p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {course.badge.meaning}
            </p>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-6 text-xs text-[var(--muted-foreground)]"
        >
          {t("noLeaderboards")}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-7 flex flex-wrap gap-3 justify-center"
        >
          <Link href="/learner/comp-card">
            <Button size="lg">
              <FileText className="h-4 w-4" />
              {t("openCompCard")}
            </Button>
          </Link>
          <Link href="/learner">
            <Button size="lg" variant="outline">
              <Home className="h-4 w-4" />
              {t("backToDashboard")}
            </Button>
          </Link>
        </motion.div>
      </CardContent>
    </Card>
  );
}
