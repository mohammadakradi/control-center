import type { MetadataRoute } from "next";

/**
 * Web app manifest — served at `/manifest.webmanifest`, which makes the dashboard installable
 * from Chrome ("Install Agent Platform…") so it runs in its own window with its own Dock /
 * Launchpad icon instead of a browser tab.
 *
 * Chromium's install criteria are exactly: `name` or `short_name`, a 192px **and** a 512px
 * icon, `start_url`, `display`, and `prefer_related_applications` unset/false — over HTTPS or
 * localhost. No service worker is required, so there isn't one: an SW's fetch handler would sit
 * in front of the SSE task stream and Next's dev HMR for no benefit on a local-only app.
 *
 * `proxy.ts` lets this route through while signed out — Chrome fetches the manifest to decide
 * installability, and a redirect to /signin would make the app un-installable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Agent Control Center",
    short_name: "Agent Control",
    description: "Manage and dispatch your Claude Code agents",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Standalone window chrome + the launch splash. The app itself is light/dark/system; a
    // manifest can only carry one colour, so this is the dark canvas token (`--color-canvas`).
    // `layout.tsx` additionally emits per-scheme <meta name="theme-color"> tags.
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    categories: ["developer", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Right-click the installed app's icon to jump straight to a section.
    shortcuts: [
      { name: "Projects", url: "/projects" },
      { name: "Agents", url: "/agents" },
      { name: "Usage", url: "/usage" },
    ],
  };
}
