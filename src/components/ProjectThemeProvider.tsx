"use client";

import * as React from "react";
import {
  DEFAULT_PROJECT_ID,
  getProject,
  type ProjectConfig,
} from "@/data/project";

interface ProjectContextValue {
  projectId: string;
  project: ProjectConfig;
  setProjectId: (id: string) => void;
}

const ProjectContext = React.createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "seq-elevate-project-v1";

/**
 * Applies the current project's brand kit by writing CSS variables to
 * <html>. Re-rendering on project change re-skins the whole UI without
 * touching individual components.
 *
 * In production this provider reads the project from the subdomain via
 * a server-resolved cookie/header. In the demo it's localStorage-backed
 * so reviewers stay in their selected project across reloads.
 */
export function ProjectThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [projectId, setProjectIdState] = React.useState(DEFAULT_PROJECT_ID);
  const project = getProject(projectId);

  // Hydrate from localStorage
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setProjectIdState(stored);
    } catch {}
  }, []);

  // Apply brand kit to <html> as CSS variables
  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", project.brand.primaryColor);
    root.style.setProperty("--primary-hover", project.brand.primaryHover);
    root.style.setProperty("--accent", project.brand.accentColor);
    // Persist
    try {
      window.localStorage.setItem(STORAGE_KEY, projectId);
    } catch {}
  }, [project, projectId]);

  const setProjectId = React.useCallback((id: string) => {
    setProjectIdState(id);
  }, []);

  const value = React.useMemo(
    () => ({ projectId, project, setProjectId }),
    [projectId, project, setProjectId]
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = React.useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside ProjectThemeProvider");
  return ctx;
}
