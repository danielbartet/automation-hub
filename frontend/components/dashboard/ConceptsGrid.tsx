"use client";

import { AdConcept, DiversityAudit } from "@/lib/api";
import { AlertTriangle, Check, X } from "lucide-react";

interface ConceptsGridProps {
  concepts: AdConcept[];
  diversityAudit: DiversityAudit;
  approvedIds: Set<number>;
  onToggle: (id: number) => void;
}

const ANGLE_BADGE_CLASSES: Record<string, string> = {
  Logical: "bg-blue-100 text-blue-700",
  Emotional: "bg-red-100 text-red-700",
  "Social Proof": "bg-green-100 text-green-700",
  "Problem-Solution": "bg-orange-100 text-orange-700",
};

const RISK_BADGE_CLASSES: Record<string, string> = {
  LOW: "bg-green-100 text-green-700",
  MEDIUM: "bg-yellow-100 text-yellow-700",
};

export function ConceptsGrid({ concepts, diversityAudit, approvedIds, onToggle }: ConceptsGridProps) {
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
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm font-medium text-gray-700">{auditSummary}</p>
        {diversityAudit.warnings && diversityAudit.warnings.length > 0 && (
          <div className="mt-2 space-y-1">
            {diversityAudit.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-700">
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
          return (
            <div
              key={concept.id}
              onClick={() => onToggle(concept.id)}
              className={`relative p-3 rounded-xl border-2 cursor-pointer transition-all select-none ${
                isApproved
                  ? "border-gray-900 bg-gray-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              {/* Approve indicator */}
              <div
                className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isApproved
                    ? "border-gray-900 bg-gray-900"
                    : "border-gray-300 bg-white"
                }`}
              >
                {isApproved && <Check className="h-3 w-3 text-white" />}
              </div>

              {/* Top badges row */}
              <div className="flex flex-wrap gap-1 mb-2 pr-6">
                <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600 truncate max-w-[120px]">
                  {concept.persona}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                    ANGLE_BADGE_CLASSES[concept.psychological_angle] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {concept.psychological_angle}
                </span>
              </div>

              {/* Hook */}
              <p className="text-sm font-bold text-gray-900 leading-snug mb-1.5 line-clamp-3">
                {concept.hook_3s}
              </p>

              {/* Body */}
              <p className="text-xs text-gray-500 line-clamp-2 mb-2">{concept.body}</p>

              {/* Bottom badges row */}
              <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                <span className="px-1.5 py-0.5 text-xs rounded border border-gray-200 text-gray-500">
                  {concept.format}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                    RISK_BADGE_CLASSES[concept.entity_id_risk] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {concept.entity_id_risk} riesgo
                </span>
                <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500 ml-auto">
                  {concept.cta}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Counter + warning */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-sm text-gray-600 font-medium">
          {approvedCount}/{concepts.length} conceptos aprobados
        </p>
        {needsMoreApprovals && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <X className="h-3.5 w-3.5" />
            Andromeda requiere mínimo 6 creativos
          </p>
        )}
      </div>
    </div>
  );
}
