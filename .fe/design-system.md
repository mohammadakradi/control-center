# Design System — Agent Platform

_Maintained by the fe-agent · source of truth for tokens & reusable components · updated 2026-06-26 (re-onboarded)_

## Styling system
- Approach: **Tailwind CSS v4** — CSS-first config, no `tailwind.config.*` file
- Token/theme source: `app/globals.css` (`@theme inline` block for font vars; all else uses Tailwind v4 defaults)
- Dark mode: **dark-only** — `html { color-scheme: dark; }` in `app/globals.css`; no toggle, no `dark:` classes needed
- Component library: **Bespoke only** — no shadcn, Radix, MUI, or Headless UI; all in `components/`

## Colors
> Use these patterns — never hardcode raw values that a Tailwind token already expresses.

### Page chrome
| Role | Tailwind class | Raw value |
|------|----------------|-----------|
| Page background | (inline CSS) `background: #0a0a0b` | `#0a0a0b` |
| Page text | (inline CSS) `color: #e7e7ea` | `#e7e7ea` |
| Card border | `border-neutral-800` | — |
| Card background | `bg-neutral-900/40` | — |
| Subtle dividers | `border-neutral-800` | — |
| Muted icon/text | `text-neutral-500` / `text-neutral-600` | — |
| Secondary text | `text-neutral-400` | — |
| Primary text | `text-neutral-300` | — |
| Scrollbar thumb | `#2a2a2e` (globals.css) | `#2a2a2e` |

### Semantic status palette (from `lib/ui.ts` `statusColor()`)
| Status | Background | Text | Border |
|--------|-----------|------|--------|
| done | `bg-emerald-500/15` | `text-emerald-300` | `border-emerald-500/30` |
| failed | `bg-red-500/15` | `text-red-300` | `border-red-500/30` |
| cancelled | `bg-neutral-500/15` | `text-neutral-300` | `border-neutral-500/30` |
| running / building / committing / awaiting_* | `bg-amber-500/15` | `text-amber-300` | `border-amber-500/30` |
| queued (default) | `bg-sky-500/15` | `text-sky-300` | `border-sky-500/30` |

### Chip tones (from `components/ui-cards.tsx`)
| Tone | Classes |
|------|---------|
| neutral | `border-neutral-700 bg-neutral-800/60 text-neutral-300` |
| ok | `border-emerald-500/30 bg-emerald-500/10 text-emerald-300` |
| violet | `border-violet-500/30 bg-violet-500/10 text-violet-300` |
| sky | `border-sky-500/30 bg-sky-500/10 text-sky-300` |

### Fact tag tones (from `components/ui-cards.tsx`)
| Tone | Classes |
|------|---------|
| neutral | `border-neutral-700 bg-neutral-800/60 text-neutral-400` |
| ok | `border-emerald-500/25 bg-emerald-500/10 text-emerald-300` |
| warn | `border-amber-500/25 bg-amber-500/10 text-amber-300` |

### Diff colors (in `ChangesList` / `DiffModal`)
| Role | Class |
|------|-------|
| Added lines | `text-emerald-400` / `bg-emerald-500/10` |
| Removed lines | `text-red-400` / `bg-red-500/10` |
| Hunk header (`@@`) | `text-sky-400` |

### Gate / approval card
| Role | Class |
|------|-------|
| Border | `border-amber-500/40` |
| Background | `bg-amber-500/10` |
| Header text | `text-amber-200` |

## Typography
- Font families: `--font-sans: var(--font-geist-sans)` · `--font-mono: var(--font-geist-mono)` (both loaded via `next/font/google` in `app/layout.tsx`)
- Type scale: Tailwind v4 defaults (`text-xs`→`text-2xl`+); no custom scale
- Common patterns: `text-sm text-neutral-400` (metadata), `text-xs text-neutral-500` (labels), `text-2xl font-bold tracking-tight` (stat values)
- Mono font used for: file paths, git hashes, code content, tag labels in `Fact`

## Spacing & layout
- Spacing scale: Tailwind v4 defaults (0–96 + fractional)
- Page container: `mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:py-8` (in `app/layout.tsx` — `pb-24` clears the mobile bottom tab bar)
- Card padding: `p-6` (via `card` const)
- Section gaps: `gap-4` to `gap-8`
- Breakpoints: Tailwind v4 defaults (`sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`)
- Grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3` pattern for tiles. **Always include the `grid-cols-1` base** — a bare `grid` with only a `lg:`/`md:` column class has no column template below that breakpoint, so it falls back to a single implicit `auto` column sized to max-content and overflows the viewport horizontally. `grid-cols-N` resolves to `minmax(0,1fr)`, which clamps the track and lets children shrink/truncate.
- Page padding: `<main>` uses `px-4 pt-6 pb-24 sm:px-6 sm:py-8` — tighter gutters + bottom-nav clearance on mobile, full padding from `sm`
- Mobile patterns: long paths/commands use `break-all` (identifiers) or `break-words` (headings); dense metadata/list rows use `flex-wrap` + `min-w-0`/`truncate` so they stack rather than overflow at ~375px; primary nav is a fixed bottom tab bar below `sm` (see `Nav`)

## Radii, shadows, borders, motion
- Radius: `rounded-2xl` (cards), `rounded-xl` (tiles), `rounded-full` (chips/badges/avatars), `rounded-md` (fact tags), `rounded-lg` (misc)
- Shadows: `shadow-2xl` on full-screen modals (`DiffModal`, `FileModal`); `shadow-lg shadow-blue-600/25` on primary CTA ("Run task" button); no custom shadow tokens
- Borders: `border border-neutral-800` (cards/tiles); `border border-neutral-700` (chips)
- Card gradient: `bg-gradient-to-b from-white/[0.015] to-transparent` layered on top of card bg
- Motion: `animate-spin` (Loader2 spinner for active states); no custom easing; no `prefers-reduced-motion` override currently applied

## Icons & assets
- Icon set: **lucide-react `^1.21.0`** — import as named exports: `import { IconName } from "lucide-react"`
- Default icon size: `size-4` (16px) inline; `size-5` (20px) for nav/prominent
- Fonts: Geist Sans + Geist Mono — loaded in `app/layout.tsx` via `next/font/google`, injected as CSS vars
- Agent avatars: `public/fe-agent.png` (fe namespace); falls back to initials initial via `AgentAvatar`

## Reusable components (reuse catalog)
> Before building anything new, check here first and reuse/extend.

| Component | Location | Variants / key props | Notes |
|-----------|----------|----------------------|-------|
| `card` (string const) | `components/ui-cards.tsx` | — | Apply with `className={card}` for standard card surface |
| `Select` | `components/ui/select.tsx` | `value`, `onChange`, `options: {value,label,description?,icon?}[]`, `searchable?`, `mono?`, `placeholder?`, `disabled?`, `className?`, `ariaLabel?` | **Searchable** bespoke combobox (popover + filter + keyboard nav). Use instead of native `<select>` or per-file wrappers. Search auto-enables past 7 options (force with `searchable`). `className` is for width/layout (e.g. `w-full`, `min-w-48`). Full combobox/listbox ARIA + keyboard. |
| `CardSection` | `components/ui-cards.tsx` | `title`, `right?`, `className?` | `card` + header row (title + optional right slot); has built-in `min-w-0` so it shrinks inside grid/flex parents. Use instead of hand-rolling `<section className={card}><h2>…</h2>` |
| `AtAGlance` | `components/AtAGlance.tsx` | `total`, `successRate`, `inProgress`, `changedFiles`, `isWorkspace`, `memberCount`, `branchInfo`, `aheadBehind` | Project summary card (stats + git/workspace facts) |
| `SourceControl` | `components/SourceControl.tsx` | `projectId`, `isWorkspace`, `members`, `branchInfo`, `changes` | Project source-control card; delegates to `WorkspaceSourceControl` or `GitControls`+`ChangesList` |
| `TaskHistory` | `components/TaskHistory.tsx` | `history`, `namespaceById`, `className?` | Reverse-chron task list; rows wrap, request text truncates |
| `Chip` | `components/ui-cards.tsx` | `tone: neutral\|ok\|violet\|sky`, `icon?` | Pill badge for metadata/tags |
| `Tile` | `components/ui-cards.tsx` | `value`, `label`, `tone?: ok` | Stat tile (number + label) |
| `Fact` | `components/ui-cards.tsx` | `icon`, `tag?`, `tagTone?: neutral\|ok\|warn` | Row in a facts list (bordered top) |
| `StatusBadge` | `components/StatusBadge.tsx` | `status: TaskStatus` | Icon + label badge; spinner on active |
| `Nav` | `components/Nav.tsx` | — | Global nav; never duplicate. **Responsive:** sticky top bar (brand + inline links) on `sm+`; on mobile the links collapse into a fixed app-style **bottom tab bar** (icon + label, `sm:hidden`). Layout `<main>` carries `pb-24` to clear it. |
| `Avatar` | `components/AgentAvatar.tsx` | `namespace: string`, `size?: number` (default 48) | Per-agent photo/initials avatar; fallback to monogram disc on 404 |
| `AgentContributors` | `components/AgentContributors.tsx` | `namespaces: string[]`, `size?: number` (default 28), `ringClass?: string` | Overlapping avatar ring; shows "no runs yet" when empty |
| `AddProjectForm` | `components/AddProjectForm.tsx` | — | Client form; project registration with macOS Finder picker |
| `NewTaskForm` | `components/NewTaskForm.tsx` | `projectId: string`, `agents: AgentLite[]`, `onboardedByAgent?: Record<string, boolean>` | Dispatch task; agent + command selector; amber warning when agent not onboarded |
| `ProjectActions` | `components/ProjectActions.tsx` | `projectId: string` | Rescan + delete buttons |
| `GitControls` | `components/GitControls.tsx` | `projectId: string`, `info: BranchInfo`, `member?: string` | Branch switcher + pull/push with ahead/behind badges |
| `ChangesList` | `components/ChangesList.tsx` | `projectId: string`, `member?: string`, `changes: GitChanges` | Uncommitted file list with diff trigger |
| `DiffModal` | `components/DiffModal.tsx` | `projectId: string`, `path: string`, `member?: string`, `onClose: () => void` | Full-screen unified diff modal |
| `FileModal` | `components/FileModal.tsx` | `projectId: string`, `path: string`, `member?: string`, `onClose: () => void` | In-repo file viewer (md/plain) |
| `WorkspaceSourceControl` | `components/WorkspaceSourceControl.tsx` | `projectId: string`, `members: ResolvedMember[]` | Tabbed git + changes per workspace repo |
| `TaskLiveView` | `components/TaskLiveView.tsx` | `taskId: string`, `runnerUrl: string`, `initialStatus: string`, `projectId: string`, `agentId: string` | SSE-based live task transcript |
| `ExpandableRequest` | `components/ExpandableRequest.tsx` | `text: string` | Collapsible markdown task request (160-char preview) |
| `Markdown` | `components/Markdown.tsx` | `children: string`, `onFileClick?: (path: string) => void` | react-markdown with GFM + break normalization; clickable file paths |
| `RunDuration` | `components/RunDuration.tsx` | `createdAt: number`, `endedAt: number \| null`, `active: boolean` | Live-ticking elapsed time chip; ticks every second while active |
| `AttachmentPicker` | `components/AttachmentPicker.tsx` | `files: File[]`, `onAdd: (files: File[]) => void`, `onRemove: (idx: number) => void` | File attach bar (Paperclip + chips); shared by `NewTaskForm` and `TaskLiveView` change-request box |
| `Markdown` | `components/Markdown.tsx` | `children: string`, `onFileClick?: (path: string) => void` | `react-markdown` with GFM + remark-breaks; normalizes agent bullet glyphs; clickable `.fe/.swe` test-scenario / `.pm/tasks` file paths |

## Accessibility baseline
- Target: WCAG AA (aspiration; not enforced by linting currently)
- Lint: ESLint `eslint-config-next/core-web-vitals` (includes some a11y rules) — no explicit `jsx-a11y` plugin override
- Conventions: Lucide icons used decoratively (no `aria-label` on icon-only buttons yet — debt); `focus-visible` not explicitly configured; keyboard nav not formally tested

## Known inconsistencies / debt
- No custom Tailwind design tokens — all colors are Tailwind defaults; no semantic token layer (e.g. `--color-primary`). Magic hex values in `globals.css` (`#0a0a0b`, `#e7e7ea`, `#2a2a2e`) should eventually become `@theme` vars.
- `prefers-reduced-motion` not handled for the `animate-spin` spinner.
- Icon-only interactive elements (e.g. action buttons) lack explicit `aria-label`.
- No test suite exists (zero test files).
