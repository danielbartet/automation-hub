"use client";
import { useCallback, useState } from "react";
import { Upload, X } from "lucide-react";

interface ImageUploadZoneProps {
  projectSlug: string;
  onUpload: (url: string) => void;
  currentUrl?: string;
  token?: string;
}

export function ImageUploadZone({ projectSlug, onUpload, currentUrl, token }: ImageUploadZoneProps) {
  const [preview, setPreview] = useState<string | null>(currentUrl || null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
    if (!allowed.includes(file.type)) {
      setError("Only JPEG, PNG, WebP, MP4 allowed");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("Max 50MB");
      return;
    }
    setError(null);
    setUploading(true);
    setProgress(10);

    // Show local preview immediately
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setProgress(30);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers: HeadersInit = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/upload/${projectSlug}`,
        { method: "POST", body: formData, headers }
      );
      setProgress(80);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || "Upload failed");
      }
      const data = await res.json();
      setProgress(100);
      setPreview(data.url);
      onUpload(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) upload(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectSlug]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
  };

  const clear = () => {
    setPreview(null);
    setProgress(0);
    onUpload("");
  };

  return (
    <div className="space-y-2">
      {preview ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="preview" className="h-32 w-32 object-cover rounded-lg" style={{ border: "1px solid #333333" }} />
          <button
            onClick={clear}
            className="absolute -top-2 -right-2 rounded-full p-0.5 shadow-sm transition-colors"
            style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#2a2a2a")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#1a1a1a")}
          >
            <X className="h-3 w-3" style={{ color: "#9ca3af" }} />
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors"
          style={{
            borderColor: dragging ? "#7c3aed" : "#333333",
            backgroundColor: dragging ? "rgba(124,58,237,0.05)" : "#1a1a1a",
          }}
        >
          <input
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,video/mp4"
            onChange={handleChange}
          />
          <Upload className="h-6 w-6 mb-1" style={{ color: "#9ca3af" }} />
          <span className="text-xs" style={{ color: "#9ca3af" }}>Drop image here or click to browse</span>
          <span className="text-xs mt-0.5" style={{ color: "#6b7280" }}>JPEG, PNG, WebP, MP4 · max 50MB</span>
        </label>
      )}
      {uploading && (
        <div className="w-full rounded-full h-1.5" style={{ backgroundColor: "#1a1a1a" }}>
          <div
            className="h-1.5 rounded-full transition-all"
            style={{ width: `${progress}%`, backgroundColor: "#7c3aed" }}
          />
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
