"use client";
import { useCallback, useState } from "react";
import { Upload, X } from "lucide-react";

interface ImageUploadZoneProps {
  projectSlug: string;
  onUpload: (url: string) => void;
  currentUrl?: string;
}

export function ImageUploadZone({ projectSlug, onUpload, currentUrl }: ImageUploadZoneProps) {
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
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/upload/${projectSlug}`,
        { method: "POST", body: formData }
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
          <img src={preview} alt="preview" className="h-32 w-32 object-cover rounded-lg border border-gray-200" />
          <button
            onClick={clear}
            className="absolute -top-2 -right-2 bg-white border border-gray-200 rounded-full p-0.5 shadow-sm hover:bg-gray-50"
          >
            <X className="h-3 w-3 text-gray-600" />
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
          className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
            dragging ? "border-gray-500 bg-gray-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
          }`}
        >
          <input
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,video/mp4"
            onChange={handleChange}
          />
          <Upload className="h-6 w-6 text-gray-400 mb-1" />
          <span className="text-xs text-gray-500">Drop image here or click to browse</span>
          <span className="text-xs text-gray-400 mt-0.5">JPEG, PNG, WebP, MP4 · max 50MB</span>
        </label>
      )}
      {uploading && (
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-gray-900 h-1.5 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
