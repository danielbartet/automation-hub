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
    fetchProjects()
      .then((data: Project[]) => {
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        if (list.length > 0) setSelectedProject(list[0]);
      })
      .catch(console.error);
  }, []);

  const loadPosts = async (project: Project, date: Date, viewMode: "week" | "month") => {
    if (!project) return;
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
        to.toISOString()
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
              className="text-sm border border-gray-200 rounded-md px-3 py-2 bg-white"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
            {/* View toggle */}
            <div className="flex border border-gray-200 rounded-lg overflow-hidden">
              {(["week", "month"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    view === v
                      ? "bg-gray-900 text-white"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
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
                className="p-1.5 hover:bg-gray-100 rounded-md"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium min-w-[180px] text-center">
                {view === "week" ? weekLabel : monthLabel}
              </span>
              <button
                onClick={() => navigate(1)}
                className="p-1.5 hover:bg-gray-100 rounded-md"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Today
            </button>
            {!isClient && (
              <button
                onClick={() => setShowPlanModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700"
              >
                <CalendarDays className="h-4 w-4" />
                Plan Content
              </button>
            )}
          </div>
        </div>

        {loading && (
          <p className="text-sm text-gray-400 text-center py-2">Loading posts...</p>
        )}

        {/* WEEK VIEW */}
        {view === "week" && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-200">
              {weekDays.map((day, idx) => {
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={idx}
                    className={`p-3 text-center border-r last:border-r-0 border-gray-100 ${
                      isToday ? "bg-gray-900" : ""
                    }`}
                  >
                    <p className={`text-xs font-medium ${isToday ? "text-gray-300" : "text-gray-500"}`}>
                      {DAY_NAMES[idx]}
                    </p>
                    <p
                      className={`text-lg font-bold mt-0.5 ${
                        isToday ? "text-white" : "text-gray-900"
                      }`}
                    >
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
                    className={`border-r last:border-r-0 border-gray-100 p-2 space-y-1.5 ${
                      isToday ? "bg-gray-50" : ""
                    }`}
                  >
                    {dayPosts.map((post) => (
                      <div
                        key={post.id}
                        onClick={() => { if (!isClient) setEditPost(post); }}
                        className={`p-2 rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all bg-white ${!isClient ? "cursor-pointer" : ""}`}
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
                              STATUS_COLORS[post.status] || "bg-gray-400"
                            }`}
                          />
                          <span className="text-xs text-gray-500 truncate">{post.status}</span>
                        </div>
                        <p className="text-xs text-gray-700 line-clamp-2">{post.caption}</p>
                      </div>
                    ))}
                    {!isClient && (
                      <button
                        onClick={() => {
                          setSelectedDay(day);
                          setShowPlanModal(true);
                        }}
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg border border-dashed border-gray-200 transition-colors"
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
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-200">
              {DAY_NAMES.map((d) => (
                <div
                  key={d}
                  className="p-3 text-center text-xs font-medium text-gray-500 border-r last:border-r-0 border-gray-100"
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
                      className="border-r last:border-r-0 border-b border-gray-100 min-h-[80px] bg-gray-50/50"
                    />
                  );
                const dayPosts = postsForDay(day);
                const isToday = isSameDay(day, today);
                const isSelected = selectedDay && isSameDay(day, selectedDay);
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    className={`border-r last:border-r-0 border-b border-gray-100 min-h-[80px] p-2 cursor-pointer hover:bg-gray-50 transition-colors ${
                      isToday ? "bg-blue-50/50" : ""
                    } ${isSelected ? "ring-2 ring-inset ring-gray-900" : ""}`}
                  >
                    <span
                      className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-sm font-medium ${
                        isToday ? "bg-gray-900 text-white" : "text-gray-700"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {dayPosts.slice(0, 3).map((post) => (
                        <div
                          key={post.id}
                          className={`w-2 h-2 rounded-full ${
                            STATUS_COLORS[post.status] || "bg-gray-400"
                          }`}
                          title={post.caption?.slice(0, 50)}
                        />
                      ))}
                      {dayPosts.length > 3 && (
                        <span className="text-xs text-gray-400">+{dayPosts.length - 3}</span>
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
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {selectedDay.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h3>
              {!isClient && (
                <button
                  onClick={() => setShowPlanModal(true)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  <Plus className="h-3 w-3" />
                  Add post
                </button>
              )}
            </div>
            {postsForDay(selectedDay).length === 0 ? (
              <p className="text-sm text-gray-400">No posts scheduled</p>
            ) : (
              <div className="space-y-2">
                {postsForDay(selectedDay).map((post) => (
                  <div
                    key={post.id}
                    onClick={() => { if (!isClient) setEditPost(post); }}
                    className={`flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-gray-300 ${!isClient ? "cursor-pointer" : ""}`}
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
                      <p className="text-sm text-gray-700 truncate">{post.caption}</p>
                      <span
                        className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${
                          post.status === "published"
                            ? "bg-green-100 text-green-700"
                            : post.status === "pending_approval"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-600"
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
