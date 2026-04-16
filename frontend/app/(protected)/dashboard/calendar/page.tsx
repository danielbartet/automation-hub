"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "lucide-react";
import { fetchProjects, fetchContentByDateRange } from "@/lib/api";
import { PlanContentModal } from "@/components/dashboard/PlanContentModal";
import { EditContentModal } from "@/components/dashboard/EditContentModal";

// Types
interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

interface ContentPost {
  id: number;
  caption: string;
  status: string;
  image_url?: string;
  scheduled_at?: string;
  created_at: string;
  content?: { slides?: unknown[]; hashtags?: string[] };
}

function getWeekDates(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Make Monday = first day
  start.setDate(start.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function getMonthDates(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const days: (Date | null)[] = Array(startPad).fill(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  return days;
}

const STATUS_COLORS: Record<string, string> = {
  published: "bg-green-500",
  pending_approval: "bg-yellow-400",
  draft: "bg-gray-400",
  approved: "bg-blue-400",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getPostDate(post: ContentPost): Date {
  const dateStr = post.scheduled_at || post.created_at;
  return new Date(dateStr);
}

export default function CalendarPage() {
  const { data: session } = useSession();
  const isClient = session?.user?.role === "client";
  const [view, setView] = useState<"week" | "month">("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editPost, setEditPost] = useState<ContentPost | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    const token = (session as any)?.accessToken as string | undefined;
    fetchProjects(token)
      .then((data: Project[]) => {
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        if (list.length > 0) setSelectedProject(list[0]);
      })
      .catch(console.error);
  }, [session]);

  const loadPosts = async (project: Project, date: Date, viewMode: "week" | "month") => {
    if (!project) return;
    const token = (session as any)?.accessToken as string | undefined;
    setLoading(true);
    try {
      let from: Date, to: Date;
      if (viewMode === "week") {
        const week = getWeekDates(date);
        from = week[0];
        to = week[6];
      } else {
        from = new Date(date.getFullYear(), date.getMonth(), 1);
        to = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      }
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      const data = await fetchContentByDateRange(
        project.slug,
        from.toISOString(),
        to.toISOString(),
        token
      );
      setPosts(data.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProject) loadPosts(selectedProject, currentDate, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, currentDate, view]);

  const navigate = (dir: 1 | -1) => {
    const d = new Date(currentDate);
    if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
  };

  const postsForDay = (day: Date) => posts.filter((p) => isSameDay(getPostDate(p), day));
  const today = new Date();

  // Week View
  const weekDays = getWeekDates(currentDate);
  const weekLabel = `${weekDays[0].toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} – ${weekDays[6].toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  // Month View
  const monthDays = getMonthDates(currentDate.getFullYear(), currentDate.getMonth());
  const monthLabel = `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;

  return (
    <div>
      <Header title="Calendar" />
      <div className="p-6 space-y-4">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-4">
            {/* Project selector */}
            <select
              value={selectedProject?.slug || ""}
              onChange={(e) =>
                setSelectedProject(projects.find((p) => p.slug === e.target.value) || null)
              }
              className="text-sm rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
              style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
            {/* View toggle */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid #333333" }}>
              {(["week", "month"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    view === v
                      ? "bg-[#7c3aed] text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                  style={{ backgroundColor: view === v ? "#7c3aed" : "#1a1a1a" }}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(-1)}
                className="p-1.5 rounded-md transition-colors text-white"
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium min-w-[180px] text-center text-white">
                {view === "week" ? weekLabel : monthLabel}
              </span>
              <button
                onClick={() => navigate(1)}
                className="p-1.5 rounded-md transition-colors text-white"
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{ border: "1px solid #333333", color: "#9ca3af" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
            >
              Today
            </button>
            {!isClient && (
              <button
                onClick={() => setShowPlanModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
              >
                <CalendarDays className="h-4 w-4" />
                Plan Content
              </button>
            )}
          </div>
        </div>

        {loading && (
          <p className="text-sm text-center py-2" style={{ color: "#9ca3af" }}>Loading posts...</p>
        )}

        {/* WEEK VIEW */}
        {view === "week" && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #222222", backgroundColor: "#111111" }}>
            <div className="grid grid-cols-7" style={{ borderBottom: "1px solid #222222" }}>
              {weekDays.map((day, idx) => {
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={idx}
                    className="p-3 text-center border-r last:border-r-0"
                    style={{ borderColor: "#1a1a1a", backgroundColor: isToday ? "#1a1a2e" : "transparent" }}
                  >
                    <p className="text-xs font-medium" style={{ color: isToday ? "#a5b4fc" : "#9ca3af" }}>
                      {DAY_NAMES[idx]}
                    </p>
                    <p className="text-lg font-bold mt-0.5" style={{ color: isToday ? "#818cf8" : "#ffffff" }}>
                      {day.getDate()}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-7 min-h-[400px]">
              {weekDays.map((day, idx) => {
                const dayPosts = postsForDay(day);
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={idx}
                    className="border-r last:border-r-0 p-2 space-y-1.5"
                    style={{ borderColor: "#1a1a1a", backgroundColor: isToday ? "#0d0d1a" : "transparent" }}
                  >
                    {dayPosts.map((post) => (
                      <div
                        key={post.id}
                        onClick={() => { if (!isClient) setEditPost(post); }}
                        className={`p-2 rounded-lg transition-all ${!isClient ? "cursor-pointer" : ""}`}
                        style={{ border: "1px solid #222222", backgroundColor: "#0d0d0d" }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = "#333333")}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = "#222222")}
                      >
                        {post.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={post.image_url}
                            alt=""
                            className="w-full h-14 object-cover rounded mb-1.5"
                          />
                        )}
                        <div className="flex items-center gap-1.5 mb-1">
                          <div
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              STATUS_COLORS[post.status] || "bg-gray-600"
                            }`}
                          />
                          <span className="text-xs truncate" style={{ color: "#9ca3af" }}>{post.status}</span>
                        </div>
                        <p className="text-xs line-clamp-2" style={{ color: "#d1d5db" }}>{post.caption}</p>
                      </div>
                    ))}
                    {!isClient && (
                      <button
                        onClick={() => {
                          setSelectedDay(day);
                          setShowPlanModal(true);
                        }}
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg transition-colors"
                        style={{ color: "#6b7280", border: "1px dashed #333333" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#161616"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#6b7280"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                      >
                        <Plus className="h-3 w-3" />
                        Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MONTH VIEW */}
        {view === "month" && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #222222", backgroundColor: "#111111" }}>
            <div className="grid grid-cols-7" style={{ borderBottom: "1px solid #222222" }}>
              {DAY_NAMES.map((d) => (
                <div
                  key={d}
                  className="p-3 text-center text-xs font-medium border-r last:border-r-0"
                  style={{ color: "#9ca3af", borderColor: "#1a1a1a" }}
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day, idx) => {
                if (!day)
                  return (
                    <div
                      key={`empty-${idx}`}
                      className="border-r last:border-r-0 border-b min-h-[80px]"
                      style={{ borderColor: "#1a1a1a", backgroundColor: "#0a0a0a" }}
                    />
                  );
                const dayPosts = postsForDay(day);
                const isToday = isSameDay(day, today);
                const isSelected = selectedDay && isSameDay(day, selectedDay);
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    className="border-r last:border-r-0 border-b min-h-[80px] p-2 cursor-pointer transition-colors"
                    style={{
                      borderColor: "#1a1a1a",
                      backgroundColor: isToday ? "#0d0d1a" : "transparent",
                      boxShadow: isSelected ? "inset 0 0 0 2px #7c3aed" : "none",
                    }}
                    onMouseEnter={e => { if (!isToday) (e.currentTarget as HTMLDivElement).style.backgroundColor = "#161616"; }}
                    onMouseLeave={e => { if (!isToday) (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
                  >
                    <span
                      className="inline-flex w-6 h-6 items-center justify-center rounded-full text-sm font-medium"
                      style={{
                        backgroundColor: isToday ? "#7c3aed" : "transparent",
                        color: isToday ? "#ffffff" : "#d1d5db",
                      }}
                    >
                      {day.getDate()}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {dayPosts.slice(0, 3).map((post) => (
                        <div
                          key={post.id}
                          className={`w-2 h-2 rounded-full ${
                            STATUS_COLORS[post.status] || "bg-gray-600"
                          }`}
                          title={post.caption?.slice(0, 50)}
                        />
                      ))}
                      {dayPosts.length > 3 && (
                        <span className="text-xs" style={{ color: "#9ca3af" }}>+{dayPosts.length - 3}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected day panel (month view) */}
        {selectedDay && view === "month" && (
          <div className="rounded-xl p-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                {selectedDay.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h3>
              {!isClient && (
                <button
                  onClick={() => setShowPlanModal(true)}
                  className="flex items-center gap-1 text-xs transition-colors"
                  style={{ color: "#9ca3af" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#ffffff")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#9ca3af")}
                >
                  <Plus className="h-3 w-3" />
                  Add post
                </button>
              )}
            </div>
            {postsForDay(selectedDay).length === 0 ? (
              <p className="text-sm" style={{ color: "#9ca3af" }}>No posts scheduled</p>
            ) : (
              <div className="space-y-2">
                {postsForDay(selectedDay).map((post) => (
                  <div
                    key={post.id}
                    onClick={() => { if (!isClient) setEditPost(post); }}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${!isClient ? "cursor-pointer" : ""}`}
                    style={{ border: "1px solid #222222" }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = "#333333")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "#222222")}
                  >
                    {post.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.image_url}
                        alt=""
                        className="w-10 h-10 object-cover rounded flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "#d1d5db" }}>{post.caption}</p>
                      <span
                        className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${
                          post.status === "published"
                            ? "bg-green-900/50 text-green-400"
                            : post.status === "pending_approval"
                            ? "bg-yellow-900/50 text-yellow-400"
                            : "bg-gray-800 text-gray-400"
                        }`}
                      >
                        {post.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showPlanModal && selectedProject && (
        <PlanContentModal
          projects={projects}
          defaultProject={selectedProject}
          defaultDate={selectedDay || currentDate}
          onClose={() => {
            setShowPlanModal(false);
            setSelectedDay(null);
          }}
          onSuccess={() => {
            setShowPlanModal(false);
            if (selectedProject) loadPosts(selectedProject, currentDate, view);
          }}
        />
      )}
      {editPost && selectedProject && (
        <EditContentModal
          post={editPost}
          projectSlug={selectedProject.slug}
          onClose={() => setEditPost(null)}
          onSaved={() => {
            setEditPost(null);
            if (selectedProject) loadPosts(selectedProject, currentDate, view);
          }}
        />
      )}
    </div>
  );
}
