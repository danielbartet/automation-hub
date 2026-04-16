"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { X, Loader2, CalendarDays, Pencil, Trash2 } from "lucide-react";
import { batchGenerateContent, updateContent } from "@/lib/api";
import { EditContentModal } from "./EditContentModal";

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface BatchPost {
  id: number;
  caption: string;
  scheduled_at: string;
  status: string;
  topic?: string;
  slides?: unknown[];
  content?: { slides?: Array<{ slide_number: number; type: string; headline?: string; body?: string; subtext?: string; cta?: string }>; hashtags?: string[] };
}

interface PlanContentModalProps {
  projects: Project[];
  defaultProject: Project;
  defaultDate: Date;
  onClose: () => void;
  onSuccess: () => void;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getPeriodDates(
  preset: string,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  const now = new Date();
  const monday = (d: Date) => {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(d);
    m.setDate(d.getDate() + diff);
    m.setHours(0, 0, 0, 0);
    return m;
  };
  const sunday = (d: Date) => {
    const m = monday(d);
    m.setDate(m.getDate() + 6);
    m.setHours(23, 59, 59, 999);
    return m;
  };
  switch (preset) {
    case "this_week":
      return { start: monday(now), end: sunday(now) };
    case "next_week": {
      const n = new Date(now);
      n.setDate(n.getDate() + 7);
      return { start: monday(n), end: sunday(n) };
    }
    case "this_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      };
    case "next_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        end: new Date(now.getFullYear(), now.getMonth() + 2, 0),
      };
    case "custom":
      return {
        start: customStart ? new Date(customStart) : now,
        end: customEnd ? new Date(customEnd) : now,
      };
    default:
      return { start: monday(now), end: sunday(now) };
  }
}

export function PlanContentModal({
  projects,
  defaultProject,
  defaultDate: _defaultDate,
  onClose,
  onSuccess,
}: PlanContentModalProps) {
  const { data: session } = useSession();
  const [projectSlug, setProjectSlug] = useState(defaultProject.slug);
  const [period, setPeriod] = useState("this_week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [count, setCount] = useState(3);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([0, 2, 4]); // Mon, Wed, Fri
  const [publishTime, setPublishTime] = useState("09:00");
  const [contentType, setContentType] = useState("carousel_6_slides");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchPost[] | null>(null);
  const [editingPost, setEditingPost] = useState<BatchPost | null>(null);

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { start, end } = getPeriodDates(period, customStart, customEnd);
      const data = await batchGenerateContent(projectSlug, {
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        count,
        days_of_week: daysOfWeek,
        publish_time: publishTime,
        content_type: contentType,
      });
      setBatchResult(data.posts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate batch");
    } finally {
      setLoading(false);
    }
  };

  const sendForApproval = async () => {
    if (!batchResult) return;
    setLoading(true);
    try {
      const token = (session as any)?.accessToken as string | undefined;
      await Promise.all(batchResult.map((p) => updateContent(p.id, { status: "pending_approval" }, token)));
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const saveDrafts = () => onSuccess();

  const removePost = (id: number) =>
    setBatchResult((prev) => (prev ? prev.filter((p) => p.id !== id) : null));

  const inputStyle = {
    backgroundColor: "#1a1a1a",
    border: "1px solid #333333",
    color: "#ffffff",
  };

  if (batchResult) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
          <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid #222222" }}>
            <div>
              <h2 className="text-lg font-semibold text-white">Batch Preview</h2>
              <p className="text-sm" style={{ color: "#9ca3af" }}>{batchResult.length} posts generated</p>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md transition-colors"
              style={{ color: "#9ca3af" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="p-6 space-y-3">
            {error && (
              <div className="p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
                {error}
              </div>
            )}
            {batchResult.map((post) => (
              <div key={post.id} className="rounded-lg p-4" style={{ border: "1px solid #222222" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {post.topic && (
                      <p className="text-xs font-medium uppercase mb-1" style={{ color: "#9ca3af" }}>{post.topic}</p>
                    )}
                    <p className="text-sm text-white line-clamp-2">{post.caption}</p>
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
                      Scheduled:{" "}
                      {new Date(post.scheduled_at).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {Array.isArray(post.slides) && post.slides.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(post.slides as Array<{ headline?: string }>).slice(0, 3).map((s, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: "#1a1a1a", color: "#9ca3af" }}
                          >
                            {s.headline || `Slide ${i + 1}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditingPost(post)}
                      className="p-1.5 rounded-md transition-colors"
                      style={{ color: "#9ca3af" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => removePost(post.id)}
                      className="p-1.5 rounded-md transition-colors"
                      style={{ color: "#9ca3af" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#450a0a"; (e.currentTarget as HTMLButtonElement).style.color = "#f87171"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex gap-3 pt-2" style={{ borderTop: "1px solid #222222" }}>
              <button
                onClick={saveDrafts}
                className="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{ border: "1px solid #333333", color: "#9ca3af" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
              >
                Save as Drafts
              </button>
              <button
                onClick={sendForApproval}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send All for Approval
              </button>
            </div>
          </div>
        </div>
        {editingPost && (
          <EditContentModal
            post={{
              id: editingPost.id,
              caption: editingPost.caption,
              scheduled_at: editingPost.scheduled_at,
              status: editingPost.status,
              content: editingPost.content,
            }}
            projectSlug={projectSlug}
            onClose={() => setEditingPost(null)}
            onSaved={() => {
              setEditingPost(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid #222222" }}>
          <h2 className="text-lg font-semibold text-white">Plan Content</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: "#9ca3af" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-white mb-1">Project</label>
            <select
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
              style={inputStyle}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Period</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {(
                [
                  ["this_week", "This week"],
                  ["next_week", "Next week"],
                  ["this_month", "This month"],
                  ["next_month", "Next month"],
                  ["custom", "Custom"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setPeriod(v)}
                  className="px-3 py-1.5 text-sm rounded-lg transition-colors"
                  style={
                    period === v
                      ? { backgroundColor: "#7c3aed", color: "#ffffff", border: "1px solid #7c3aed" }
                      : { backgroundColor: "transparent", color: "#9ca3af", border: "1px solid #333333" }
                  }
                  onMouseEnter={e => { if (period !== v) { (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; } }}
                  onMouseLeave={e => { if (period !== v) { (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; } }}
                >
                  {l}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs block mb-1" style={{ color: "#9ca3af" }}>Start</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: "#9ca3af" }}>End</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                    style={inputStyle}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white mb-1">Posts count</label>
              <input
                type="number"
                min={1}
                max={30}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-1">Publish time</label>
              <input
                type="time"
                value={publishTime}
                onChange={(e) => setPublishTime(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Publish days</label>
            <div className="flex gap-2">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className="flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors"
                  style={
                    daysOfWeek.includes(i)
                      ? { backgroundColor: "#7c3aed", color: "#ffffff", border: "1px solid #7c3aed" }
                      : { backgroundColor: "transparent", color: "#9ca3af", border: "1px solid #333333" }
                  }
                  onMouseEnter={e => { if (!daysOfWeek.includes(i)) { (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; } }}
                  onMouseLeave={e => { if (!daysOfWeek.includes(i)) { (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; } }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-1">Content type</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
              style={inputStyle}
            >
              <option value="carousel_6_slides">Carousel (6 slides)</option>
              <option value="single_image">Single Image</option>
              <option value="text_post">Text Post</option>
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || daysOfWeek.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating {count} posts...
              </>
            ) : (
              <>
                <CalendarDays className="h-4 w-4" />
                Generate {count} Posts
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
