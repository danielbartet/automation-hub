"use client";

import { useState } from "react";
import { updateProject, assignMetaAssets } from "@/lib/api";
import { X, Check } from "lucide-react";
import { useT } from "@/lib/i18n";

interface AssetItem {
  id: string;
  name?: string;
  username?: string;
}

interface AssetsPayload {
  pages: AssetItem[];
  ad_accounts: AssetItem[];
  instagram_accounts: AssetItem[];
  current: {
    page_id: string | null;
    instagram_id: string | null;
    ad_account_id: string | null;
  };
}

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  media_config?: Record<string, unknown>;
  facebook_page_id?: string | null;
  instagram_account_id?: string | null;
  ad_account_id?: string | null;
  meta_token_expires_at?: string | null;
}

interface Props {
  slug: string;
  assets: AssetsPayload;
  onClose: () => void;
  onSuccess: (updated: Project) => void;
  /** When provided, uses POST /meta-assets instead of PUT /projects/:slug */
  authToken?: string;
}

function RadioList({
  label,
  items,
  labelKey,
  selected,
  onChange,
}: {
  label: string;
  items: AssetItem[];
  labelKey: "name" | "username";
  selected: string | null;
  onChange: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#9ca3af" }}>
        {label}
      </p>
      {items.length === 1 ? (
        // Single item — show as info, not selectable
        <div
          className="flex items-center gap-3 rounded-md px-3 py-2.5"
          style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333" }}
        >
          <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "#7c3aed" }} />
          <div className="min-w-0">
            <p className="text-sm text-white truncate">
              {items[0][labelKey] ?? items[0].id}
            </p>
            <p className="text-xs truncate" style={{ color: "#6b7280" }}>
              {items[0].id}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const isSelected = selected === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors"
                style={{
                  backgroundColor: isSelected ? "#1e1230" : "#1a1a1a",
                  border: `1px solid ${isSelected ? "#7c3aed" : "#333333"}`,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1f1f1f";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#444444";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333";
                  }
                }}
              >
                {/* Radio indicator */}
                <div
                  className="shrink-0 h-4 w-4 rounded-full flex items-center justify-center"
                  style={{
                    border: `2px solid ${isSelected ? "#7c3aed" : "#555555"}`,
                    backgroundColor: isSelected ? "#7c3aed" : "transparent",
                  }}
                >
                  {isSelected && (
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {item[labelKey] ?? item.id}
                  </p>
                  <p className="text-xs truncate" style={{ color: "#6b7280" }}>
                    {item.id}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MetaAssetSelectModal({ slug, assets, onClose, onSuccess, authToken }: Props) {
  const t = useT();
  const [selectedPageId, setSelectedPageId] = useState<string | null>(
    assets.current.page_id ?? assets.pages[0]?.id ?? null
  );
  const [selectedInstagramId, setSelectedInstagramId] = useState<string | null>(
    assets.current.instagram_id ?? assets.instagram_accounts[0]?.id ?? null
  );
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string | null>(
    assets.current.ad_account_id ?? assets.ad_accounts[0]?.id ?? null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let updated: Project;
      if (authToken && selectedPageId && selectedInstagramId && selectedAdAccountId) {
        // New flow: use dedicated assign endpoint
        updated = await assignMetaAssets(authToken, slug, {
          facebook_page_id: selectedPageId,
          instagram_account_id: selectedInstagramId,
          ad_account_id: selectedAdAccountId,
        });
      } else {
        // Legacy flow: use generic project update
        updated = await updateProject(slug, {
          ...(selectedPageId ? { facebook_page_id: selectedPageId } : {}),
          ...(selectedInstagramId ? { instagram_account_id: selectedInstagramId } : {}),
          ...(selectedAdAccountId ? { ad_account_id: selectedAdAccountId } : {}),
        }, authToken);
      }
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.meta_modal_error_default);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid #222222" }}>
          <div>
            <h2 className="text-base font-semibold text-white">{t.meta_modal_title}</h2>
            <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>
              {t.meta_modal_subtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: "#6b7280" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1f1f1f";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1">
          <RadioList
            label={t.meta_modal_label_pages}
            items={assets.pages}
            labelKey="name"
            selected={selectedPageId}
            onChange={setSelectedPageId}
          />
          <RadioList
            label={t.meta_modal_label_instagram}
            items={assets.instagram_accounts}
            labelKey="username"
            selected={selectedInstagramId}
            onChange={setSelectedInstagramId}
          />
          <RadioList
            label={t.meta_modal_label_ad_accounts}
            items={assets.ad_accounts}
            labelKey="name"
            selected={selectedAdAccountId}
            onChange={setSelectedAdAccountId}
          />

          {error && (
            <p className="text-sm rounded-md px-3 py-2" style={{ backgroundColor: "#450a0a", color: "#f87171", border: "1px solid #7f1d1d" }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 shrink-0" style={{ borderTop: "1px solid #222222" }}>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md transition-colors"
            style={{ color: "#9ca3af", border: "1px solid #333333" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333";
            }}
          >
            {t.meta_modal_cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={(e) => {
              if (!saving) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed";
            }}
          >
            {saving ? t.meta_modal_saving : t.meta_modal_save}
          </button>
        </div>
      </div>
    </div>
  );
}
