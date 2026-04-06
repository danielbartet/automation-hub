"use client";

import { useState } from "react";
import { AdConcept, DiversityAudit } from "@/lib/api";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";

interface ConceptsGridProps {
  concepts: AdConcept[];
  diversityAudit: DiversityAudit;
  approvedIds: Set<number>;
  onToggle: (id: number) => void;
  onRegenerateConcept?: (conceptId: number, excludedHooks: string[]) => Promise<void>;
}

const ANGLE_BADGE_CLASSES: Record<string, string> = {
  Logical: "bg-blue-900/50 text-blue-400",
  Emotional: "bg-red-900/50 text-red-400",
  "Social Proof": "bg-green-900/50 text-green-400",
  "Problem-Solution": "bg-orange-900/50 text-orange-400",
};

const RISK_BADGE_CLASSES: Record<string, string> = {
  LOW: "bg-green-900/50 text-green-400",
  MEDIUM: "bg-yellow-900/50 text-yellow-400",
};

export function ConceptsGrid({ concepts, diversityAudit, approvedIds, onToggle, onRegenerateConcept }: ConceptsGridProps) {
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const approvedCount = approvedIds.size;
  const needsMoreApprovals = approvedCount < 6;

  const auditSummary = [
    `${concepts.length} conceptos`,
    diversityAudit.angles_covered?.length
      ? `${diversityAudit.angles_covered.length} ángulos`
      : null,
    diversityAudit.formats_covered?.length
      ? `${diversityAudit.formats_covered.length} formatos`
      : null,
    diversityAudit.estimated_unique_entity_ids
      ? `~${diversityAudit.estimated_unique_entity_ids} Entity IDs únicos`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      {/* Audit summary */}
      <div className="p-3 rounded-lg" style={{ backgroundColor: "#1a1a1a", border: "1px solid #222222" }}>
        <p className="text-sm font-medium text-white">{auditSummary}</p>
        {diversityAudit.warnings && diversityAudit.warnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {diversityAudit.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-400">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Concepts grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
        {concepts.map((concept) => {
          const isApproved = approvedIds.has(concept.id);
          const isRegenerating = regeneratingId === concept.id;
          return (
            <div
              key={concept.id}
              onClick={() => onToggle(concept.id)}
              className="relative p-3 rounded-xl border-2 cursor-pointer transition-all select-none"
              style={{
                borderColor: isApproved ? "#7c3aed" : "#333333",
                backgroundColor: isApproved ? "rgba(124,58,237,0.08)" : "#0d0d0d",
              }}
            >
              {/* Approve indicator */}
              <div
                className="absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                style={{
                  borderColor: isApproved ? "#7c3aed" : "#444444",
                  backgroundColor: isApproved ? "#7c3aed" : "transparent",
                }}
              >
                {isApproved && <Check className="h-3 w-3 text-white" />}
              </div>

              {/* Top badges row */}
              <div className="flex flex-wrap gap-1 mb-2 pr-6">
                <span className="px-1.5 py-0.5 text-xs font-medium rounded truncate max-w-[120px]" style={{ backgroundColor: "#1a1a1a", color: "#9ca3af" }}>
                  {concept.persona}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                    ANGLE_BADGE_CLASSES[concept.psychological_angle] ?? "bg-gray-800 text-gray-400"
                  }`}
                >
                  {concept.psychological_angle}
                </span>
              </div>

              {/* Hook */}
              <p className="text-sm font-bold text-white leading-snug mb-1.5 line-clamp-3">
                {concept.hook_3s}
              </p>

              {/* Body */}
              <p className="text-xs line-clamp-2 mb-2" style={{ color: "#9ca3af" }}>{concept.body}</p>

              {/* Bottom badges row */}
              <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                <span className="px-1.5 py-0.5 text-xs rounded" style={{ border: "1px solid #333333", color: "#9ca3af" }}>
                  {concept.format}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                    RISK_BADGE_CLASSES[concept.entity_id_risk] ?? "bg-gray-800 text-gray-400"
                  }`}
                >
                  {concept.entity_id_risk} riesgo
                </span>
                <span className="px-1.5 py-0.5 text-xs rounded ml-auto" style={{ backgroundColor: "#1a1a1a", color: "#9ca3af" }}>
                  {concept.cta}
                </span>
              </div>

              {/* Regenerar button */}
              {onRegenerateConcept && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isRegenerating) return;
                    setRegeneratingId(concept.id);
                    try {
                      const excludedHooks = concepts.map(c => c.hook_3s);
                      await onRegenerateConcept(concept.id, excludedHooks);
                    } finally {
                      setRegeneratingId(null);
                    }
                  }}
                  disabled={isRegenerating || regeneratingId !== null}
                  className="mt-2 flex items-center gap-1 text-xs transition-colors disabled:opacity-40"
                  style={{ color: "#6b7280" }}
                  onMouseEnter={e => { if (!isRegenerating && regeneratingId === null) (e.currentTarget as HTMLButtonElement).style.color = "#d1d5db"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#6b7280"; }}
                >
                  {isRegenerating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Regenerar este concepto
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Counter + warning */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-sm font-medium" style={{ color: "#9ca3af" }}>
          {approvedCount}/{concepts.length} conceptos aprobados
        </p>
        {needsMoreApprovals && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <X className="h-3.5 w-3.5" />
            Andromeda requiere mínimo 6 creativos
          </p>
        )}
      </div>
    </div>
  );
}
