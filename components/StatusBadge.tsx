import { Ban, Check, CircleDashed, Clock, Loader2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { STATUS_LABEL, statusColor } from "@/lib/ui";
import type { TaskStatus } from "@/lib/db/schema";

const ICON: Record<string, LucideIcon> = {
  done: Check,
  failed: X,
  cancelled: Ban,
  queued: Clock,
  running: Loader2,
  building: Loader2,
  committing: Loader2,
  awaiting_proposal: CircleDashed,
  awaiting_report: CircleDashed,
};

const SPINNING = new Set(["running", "building", "committing"]);

export function StatusBadge({ status }: { status: string }) {
  const Icon = ICON[status] ?? CircleDashed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor(status)}`}
    >
      <Icon className={`size-3 ${SPINNING.has(status) ? "animate-spin" : ""}`} />
      {STATUS_LABEL[status as TaskStatus] ?? status}
    </span>
  );
}
