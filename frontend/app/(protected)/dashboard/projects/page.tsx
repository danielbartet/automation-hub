"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { fetchProjects } from "@/lib/api";
import { Settings, PlusCircle, ExternalLink, FolderKanban } from "lucide-react";
import { ProjectFormDialog } from "@/components/dashboard/ProjectFormDialog";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  media_config?: Record<string, unknown>;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleProjectUpdated = (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  return (
    <div>
      <Header title="Projects" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {loading ? "Loading projects..." : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
          </p>
          <button
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
            onClick={() => alert("New project form coming soon")}
          >
            <PlusCircle className="h-4 w-4" />
            New Project
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-40 text-sm text-gray-500">
            Loading...
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 flex flex-col items-center gap-4">
            <FolderKanban className="h-12 w-12 text-gray-300" />
            <div className="text-center">
              <p className="text-base font-medium text-gray-900">No projects yet</p>
              <p className="text-sm text-gray-500 mt-1">Create your first project to get started.</p>
            </div>
            <button
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
              onClick={() => alert("New project form coming soon")}
            >
              <PlusCircle className="h-4 w-4" />
              New Project
            </button>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">{project.name}</h3>
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-600 rounded">
                      {project.slug}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      project.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {project.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-auto">
                  <Link
                    href={`/dashboard?project=${project.slug}`}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View Dashboard
                  </Link>
                  <button
                    className="inline-flex items-center justify-center p-2 text-gray-500 hover:text-gray-900 border border-gray-200 rounded-md hover:border-gray-300 transition-colors"
                    title="Project settings"
                    onClick={() => setEditingProject(project)}
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingProject && (
        <ProjectFormDialog
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSuccess={handleProjectUpdated}
        />
      )}
    </div>
  );
}
