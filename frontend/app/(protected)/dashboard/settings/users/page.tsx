"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, X, Check, Loader2, ShieldAlert } from "lucide-react";
import { fetchUsers, createUser, updateUser, fetchProjects } from "@/lib/api";
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
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">New User</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-md">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
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
              <label className="block text-sm font-medium text-gray-300 mb-2">Projects</label>
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
              <span className="text-sm text-gray-300">Can approve optimizer actions</span>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-white text-sm disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Create User
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
      setError(err instanceof Error ? err.message : "Failed to update user");
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
            <h2 className="text-white font-semibold text-lg">Edit User</h2>
            <p className="text-gray-400 text-sm">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-md">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
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
              <label className="block text-sm font-medium text-gray-300 mb-2">Projects</label>
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
              <span className="text-sm text-gray-300">Can approve optimizer actions</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-300">Active account</span>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md text-white text-sm disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
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
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (session?.user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 gap-3">
        <ShieldAlert className="h-10 w-10 text-red-400" />
        <p className="text-gray-400 text-sm">Access denied</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-950 min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Users</h1>
            <p className="text-gray-400 text-sm mt-1">Manage user accounts and permissions</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            New User
          </button>
        </div>

        {/* Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading users...
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
              No users found.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-4">
                      <span className="text-white text-sm font-medium">{user.name}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-gray-400 text-sm">{user.email}</span>
                    </td>
                    <td className="px-5 py-4">
                      <Badge role={user.role} />
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${user.is_active ? "text-green-400" : "text-gray-500"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.is_active ? "bg-green-400" : "bg-gray-600"}`} />
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => setEditingUser(user)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 rounded-md transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
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
