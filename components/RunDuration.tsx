"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { Chip } from "@/components/ui-cards";
import { formatDuration } from "@/lib/ui";

/** Shows how long a run took. Ticks live while the task is still active. */
export function RunDuration({
  createdAt,
  endedAt,
  active,
}: {
  createdAt: number;
  endedAt: number | null;
  active: boolean;
}) {
  const [now, setNow] = useState(() => endedAt ?? Date.now());

  useEffect(() => {
    if (endedAt || !active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endedAt, active]);

  const elapsed = formatDuration(createdAt, endedAt ?? now);
  if (!elapsed) return null;

  return (
    <Chip icon={<Timer className="size-3" />} tone={endedAt ? "muted" : "info"}>
      {elapsed}
    </Chip>
  );
}
