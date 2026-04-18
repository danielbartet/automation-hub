"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { fetchProjects } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

interface ProjectContextValue {
  projects: Project[];
  selectedSlug: string;
  selectedProject: Project | null;
  setSelectedSlug: (slug: string) => void;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue>({
  projects: [],
  selectedSlug: "",
  selectedProject: null,
  setSelectedSlug: () => {},
  loading: true,
});

const STORAGE_KEY = "hub_selected_project_slug";

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlugState] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const setSelectedSlug = useCallback((slug: string) => {
    setSelectedSlugState(slug);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, slug);
    }
  }, []);

  useEffect(() => {
    const token = (session as { accessToken?: string } | null)?.accessToken;
    if (!token) return;

    fetchProjects(token)
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (arr.length === 0) return;

        const stored =
          typeof window !== "undefined"
            ? localStorage.getItem(STORAGE_KEY)
            : null;
        const valid = stored && arr.some((p) => p.slug === stored);
        setSelectedSlugState(valid ? stored! : arr[0].slug);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  const selectedProject = projects.find((p) => p.slug === selectedSlug) ?? null;

  return (
    <ProjectContext.Provider
      value={{ projects, selectedSlug, selectedProject, setSelectedSlug, loading }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
