"use client";

import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { COMPOSE_PARAM, REONBOARD_EVENT } from "@/lib/ui";

/**
 * The health nudge's one action: hand the New task composer over with `onboard` picked.
 *
 * A real link (`?compose=onboard#new-task`) so a middle-click, a copied URL or a reload still
 * arrives set up — but a plain click is intercepted. Navigating to the page you are already on
 * keeps `NewTaskForm` mounted, so the param alone changed the URL and nothing else (the bug
 * behind "Re-onboard does nothing", 2026-09-29). The click tells the mounted form directly and
 * brings it into view.
 */
export function ReonboardButton() {
  return (
    <Link
      href={`?${COMPOSE_PARAM}=onboard#new-task`}
      scroll={false}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        window.dispatchEvent(new Event(REONBOARD_EVENT));
        document.getElementById("new-task")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className={buttonClasses("secondary", "sm")}
    >
      Re-onboard
    </Link>
  );
}
