import {
  Boxes,
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
 * Tasks sits with the other work entities (agents, projects) rather than beside Usage and
 * Settings. `isActive` matches by prefix, so `/tasks/<id>` keeps the Tasks entry lit.
 *
 * **Six entries is the mobile tab bar's practical ceiling.** Each tab is `flex-1`, so at
 * 320px six tracks are ~53px and the longest labels ("Dashboard", "Projects", "Settings")
 * ellipsize — survivable, because the icon carries recognition and the full label is still
 * the link's accessible name. A seventh needs a real overflow affordance, not a shorter word.
 */
export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/agents", label: "Agents", Icon: Boxes },
  { href: "/projects", label: "Projects", Icon: FolderGit2 },
  { href: "/tasks", label: "Tasks", Icon: ListChecks },
  { href: "/usage", label: "Usage", Icon: Gauge },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);
