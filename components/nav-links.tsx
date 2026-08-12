import {
  Boxes,
  ClipboardList,
  FolderGit2,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavLink = { href: string; label: string; Icon: LucideIcon };

/**
 * The primary nav, in one place — `Sidebar` and `MobileTabBar` both render this list.
 *
 * Backlog and Tasks sit with the other work entities (agents, projects) rather than beside
 * Usage and Settings, in the order work moves through them: planned, then run. `isActive`
 * matches by prefix, so `/tasks/<id>` keeps the Tasks entry lit.
 *
 * **Seven entries is past what the mobile tab bar can label.** Each tab is `flex-1`, so at
 * 320px seven tracks are ~45px — too narrow for any of these words. Rather than abbreviate,
 * `MobileTabBar` drops to icons below `sm` and shows the labels again from 640px up; the
 * label stays the link's accessible name at every width. Adding an eighth is fine for the
 * sidebar, but check the icon row still reads on a phone.
 */
export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/agents", label: "Agents", Icon: Boxes },
  { href: "/projects", label: "Projects", Icon: FolderGit2 },
  { href: "/backlog", label: "Backlog", Icon: ClipboardList },
  { href: "/tasks", label: "Tasks", Icon: ListChecks },
  { href: "/usage", label: "Usage", Icon: Gauge },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);
