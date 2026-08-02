import {
  Boxes,
  FolderGit2,
  Gauge,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavLink = { href: string; label: string; Icon: LucideIcon };

export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/agents", label: "Agents", Icon: Boxes },
  { href: "/projects", label: "Projects", Icon: FolderGit2 },
  { href: "/usage", label: "Usage", Icon: Gauge },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);
