# Frontend Notes & Gotchas

_Read before acting · update after every decision or change · keep entries short and accurate_

## Next.js version warning
This project uses Next.js `16.2.9` — far beyond the public release train. Per `AGENTS.md`, read `node_modules/next/dist/docs/` before writing any Next.js code. Route params are typed as `Promise<{id: string}>` (async params), and pages use `export const dynamic = "force-dynamic"`.

## Tailwind CSS v4 — no config file
Tailwind v4 uses a CSS-first config model. There is NO `tailwind.config.ts`. Custom theme tokens go into the `@theme inline {}` block in `app/globals.css`. Utility classes are generated from CSS variables automatically. Don't create a `tailwind.config.*` file — it's not the v4 pattern.

## Dark-only UI
The app is dark-only (`html { color-scheme: dark }`). Never use `dark:` variant classes — they're unnecessary and will confuse readers. Don't add a light mode unless explicitly requested.

## No test suite
Zero test files exist. Don't invent a test setup. If asked to add tests, first align with the user on the testing framework.

## Component library: bespoke only
No shadcn/ui, Radix, or MUI. All components are handbuilt. Reuse `Chip`, `Tile`, `Fact`, `card` (from `ui-cards.tsx`) and `StatusBadge` before writing new primitives.

## SSE for live task view
`TaskLiveView` uses `EventSource` (SSE) to stream task transcripts. The runner at `runner/server.ts` (Hono, port separate from Next.js) is the SSE source. The Next.js dev server and runner must both be running (`pnpm dev` starts both via `concurrently`).

## Agent avatar images
Agent avatars live in `public/` as `<namespace>-agent.png` (e.g. `fe-agent.png`, `swe-agent.png`). The `Avatar` component falls back to initials if the image 404s.
