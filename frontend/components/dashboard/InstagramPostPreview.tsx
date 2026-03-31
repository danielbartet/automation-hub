"use client";
import { useState } from "react";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Image,
} from "lucide-react";

interface InstagramPostPreviewProps {
  imageUrls: string[];
  caption: string;
  hashtags: string[];
  username: string;
  className?: string;
}

export function InstagramPostPreview({
  imageUrls,
  caption,
  hashtags,
  username,
  className = "",
}: InstagramPostPreviewProps) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const total = imageUrls.length;
  const hasMultiple = total > 1;

  const goPrev = () => setCurrentSlide((s) => Math.max(0, s - 1));
  const goNext = () => setCurrentSlide((s) => Math.min(total - 1, s + 1));

  const currentUrl = imageUrls[currentSlide] ?? "";
  const shortCaption = caption.length > 125 ? caption.slice(0, 125) : caption;
  const showEllipsis = caption.length > 125;
  const displayHashtags = hashtags.slice(0, 3);

  return (
    <div
      className={`flex flex-col bg-white rounded-md overflow-hidden ${className}`}
      style={{ border: "1px solid #333333" }}
      style={{ width: 380 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-gray-300 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-900">@{username}</span>
        </div>
        <span className="text-gray-500 text-lg leading-none font-bold tracking-widest">···</span>
      </div>

      {/* Image area */}
      <div
        className="relative bg-gray-100"
        style={{ aspectRatio: "1 / 1", width: "100%" }}
      >
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={`Slide ${currentSlide + 1}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-800">
            <Image className="h-12 w-12 text-gray-500" />
          </div>
        )}

        {/* Slide counter badge */}
        {hasMultiple && (
          <span className="absolute top-2 right-2 bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded-full">
            {currentSlide + 1}/{total}
          </span>
        )}

        {/* Prev arrow */}
        {hasMultiple && currentSlide > 0 && (
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1 transition-colors"
            aria-label="Slide anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        {/* Next arrow */}
        {hasMultiple && currentSlide < total - 1 && (
          <button
            type="button"
            onClick={goNext}
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1 transition-colors"
            aria-label="Slide siguiente"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Dots indicator */}
      {hasMultiple && (
        <div className="flex justify-center gap-1 py-2">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrentSlide(i)}
              aria-label={`Ir a slide ${i + 1}`}
              className={`rounded-full transition-colors ${
                i === currentSlide
                  ? "bg-blue-500 w-2 h-2"
                  : "bg-gray-300 w-1.5 h-1.5"
              }`}
            />
          ))}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-4">
          <Heart className="h-6 w-6 text-gray-800" />
          <MessageCircle className="h-6 w-6 text-gray-800" />
          <Send className="h-6 w-6 text-gray-800" />
        </div>
        <Bookmark className="h-6 w-6 text-gray-800" />
      </div>

      {/* Likes */}
      <div className="px-3 pb-1">
        <span className="text-sm font-semibold text-gray-900">Me gusta: 1,234</span>
      </div>

      {/* Caption */}
      <div className="px-3 pb-1 text-sm text-gray-900">
        <span className="font-semibold">@{username}</span>{" "}
        {shortCaption}
        {showEllipsis && (
          <span className="text-gray-400 cursor-pointer"> ... más</span>
        )}
      </div>

      {/* Hashtags */}
      {displayHashtags.length > 0 && (
        <div className="px-3 pb-1 text-sm text-blue-500 space-x-1">
          {displayHashtags.map((tag) => (
            <span key={tag}>#{tag.replace(/^#/, "")}</span>
          ))}
        </div>
      )}

      {/* Ver comentarios */}
      <div className="px-3 pb-1">
        <span className="text-sm text-gray-400">Ver los 24 comentarios</span>
      </div>

      {/* Timestamp */}
      <div className="px-3 pb-3">
        <span className="text-xs text-gray-400 uppercase">Hace 2 horas</span>
      </div>
    </div>
  );
}
