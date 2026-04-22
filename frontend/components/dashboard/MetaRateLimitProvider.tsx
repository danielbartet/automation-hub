"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { MetaRateLimitModal, MetaRateLimitDetail } from "./MetaRateLimitModal";

interface MetaRateLimitContextValue {
  triggerRateLimit: (detail: MetaRateLimitDetail) => void;
}

const MetaRateLimitContext = createContext<MetaRateLimitContextValue | null>(null);

export function useMetaRateLimit(): MetaRateLimitContextValue {
  const ctx = useContext(MetaRateLimitContext);
  if (!ctx) {
    throw new Error("useMetaRateLimit must be used inside MetaRateLimitProvider");
  }
  return ctx;
}

/**
 * Wrap the dashboard layout with this provider so any child component can
 * call `triggerRateLimit(detail)` to surface the Meta rate-limit modal.
 *
 * API helpers should call this when they receive a 429 with
 * `detail.code === "META_RATE_LIMIT"`.
 */
export function MetaRateLimitProvider({ children }: { children: ReactNode }) {
  const [detail, setDetail] = useState<MetaRateLimitDetail | null>(null);

  const triggerRateLimit = useCallback((d: MetaRateLimitDetail) => {
    setDetail(d);
  }, []);

  const handleClose = useCallback(() => {
    setDetail(null);
  }, []);

  return (
    <MetaRateLimitContext.Provider value={{ triggerRateLimit }}>
      {children}
      {detail && <MetaRateLimitModal detail={detail} onClose={handleClose} />}
    </MetaRateLimitContext.Provider>
  );
}
