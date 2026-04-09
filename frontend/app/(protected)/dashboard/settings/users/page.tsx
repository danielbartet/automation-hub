"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, X, Check, Loader2, ShieldAlert } from "lucide-react";
import { fetchUsers, createUser, updateUser, fetchProjects } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Project } from "@/types";

interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator" | "client";
  is_active: boolean;
}

interface UserFormData {
  name: string;
  email: string;
  password: string;
  role: string;
  project_ids: number[];
  can_approve: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  operator: "Operator",
  client: "Client",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-900/50 text-purple-300 border border-purple-700",
  operator: "bg-blue-900/50 text-blue-300 border border-blue-700",
  client: "bg-gray-700 text-gray-300 border border-gray-600",
};

function Badge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[role] || ROLE_COLORS.client}`}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

interface CreateModalProps {
  token: string;
  projects: Project[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateUserModal({ token, projects, onClose, onCreated }: CreateModalProps) {
  const t = useT();
  const [form, setForm] = useState<UserFormData>({
    name: "",
    email: "",
    password: "",
    role: "operator",
    project_ids: [],
    can_approve: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleProject = (id: number) => {
    setForm(prev => ({
      ...prev,
      project_ids: prev.project_ids.includes(id)
        ? prev.project_ids.filter(p => p !== id)
        : [...prev.project_ids, id],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createUser(token, form);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.users_create_error_default);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">{t.users_create_title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-md">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t.users_create_name}</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t.users_create_email}</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t.users_create_password}</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t.users_create_role}</label>
            <select
              value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="client">Client</option>
            </select>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t.users_create_projects}</label>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {projects.map(project => (
                  <label key={project.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={form.project_ids.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                      {project.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.can_approve}
                onChange={e => setForm(p => ({ ...p, can_approve: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-300">{t.users_create_can_approve}</span>
            </label>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-700 rounded-md text-gray-300 hover:bg-gray-800 text-sm transition-colors"
            >
              {t.users_create_cancel}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-white text-sm disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t.users_create_submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditModalProps {
  user: User;
  token: string;
  projects: Project[];
  onClose: () => void;
  onUpdated: () => void;
}

function EditUserModal({ user, token, projects, onClose, onUpdated }: EditModalProps) {
  const t = useT();
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [canApprove, setCanApprove] = useState(false);
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleProject = (id: number) => {
    setProjectIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await updateUser(token, user.id, {
        role,
        is_active: isActive,
        can_approve: canApprove,
        project_ids: projectIds,
      });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.users_edit_error_default);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-white font-semibold text-lg">{t.users_edit_title}</h2>
            <p className="text-gray-400 text-sm">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-md">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t.users_edit_role}</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as User["role"])}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="client">Client</option>
            </select>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t.users_edit_projects}</label>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {projects.map(project => (
                  <label key={project.id} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={projectIds.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                      {project.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={canApprove}
                onChange={e => setCanApprove(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-300">{t.users_edit_can_approve}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-300">{t.users_edit_is_active}</span>
            </label>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-700 rounded-md text-gray-300 hover:bg-gray-800 text-sm transition-colors"
            >
              {t.users_edit_cancel}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-white text-sm disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t.users_edit_save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const t = useT();
  const { data: session, status } = useSession();
  const router = useRouter();
  const token = session?.accessToken || "";

  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "admin") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  const loadData = async () => {
    if (!token) return;
    setLoadingUsers(true);
    try {
      const [usersData, projectsData] = await Promise.all([
        fetchUsers(token),
        fetchProjects(),
      ]);
      setUsers(usersData || []);
      setProjects(projectsData || []);
    } catch {
      // ignore
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (token) loadData();
  }, [token]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#9ca3af" }} />
      </div>
    );
  }

  if (session?.user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3" style={{ backgroundColor: "#0a0a0a" }}>
        <ShieldAlert className="h-10 w-10 text-red-400" />
        <p className="text-sm" style={{ color: "#9ca3af" }}>{t.users_access_denied}</p>
      </div>
    );
  }

  return (
    <div className="p-6 min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{t.users_page_title}</h1>
            <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>{t.users_page_subtitle}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
          >
            <Plus className="h-4 w-4" />
            {t.users_new_user}
          </button>
        </div>

        {/* Table */}
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
          {loadingUsers ? (
            <div className="flex items-center justify-center py-16 text-sm gap-2" style={{ color: "#9ca3af" }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.users_loading}
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm" style={{ color: "#9ca3af" }}>
              {t.users_empty}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #222222" }}>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: "#9ca3af" }}>{t.users_col_name}</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: "#9ca3af" }}>{t.users_col_email}</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: "#9ca3af" }}>{t.users_col_role}</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: "#9ca3af" }}>{t.users_col_status}</th>
                  <th className="text-right px-5 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: "#9ca3af" }}>{t.users_col_actions}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} style={{ borderTop: "1px solid #1a1a1a" }} className="hover:bg-[#161616] transition-colors">
                    <td className="px-5 py-4">
                      <span className="text-white text-sm font-medium">{user.name}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm" style={{ color: "#9ca3af" }}>{user.email}</span>
                    </td>
                    <td className="px-5 py-4">
                      <Badge role={user.role} />
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${user.is_active ? "text-green-400" : "text-gray-500"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? "bg-green-400" : "bg-gray-600"}`} />
                        {user.is_active ? t.users_status_active : t.users_status_inactive}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                        style={{ color: "#9ca3af", border: "1px solid #333333" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                      >
                        <Pencil className="h-3 w-3" />
                        {t.users_edit}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          token={token}
          projects={projects}
          onClose={() => setShowCreate(false)}
          onCreated={loadData}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          token={token}
          projects={projects}
          onClose={() => setEditingUser(null)}
          onUpdated={loadData}
        />
      )}
    </div>
  );
}
