import { Boxes, FolderGit2, LayoutDashboard, type LucideIcon } from "lucide-react";

export type NavLink = { href: string; label: string; Icon: LucideIcon };

export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/agents", label: "Agents", Icon: Boxes },
  { href: "/projects", label: "Projects", Icon: FolderGit2 },
];

export const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);
