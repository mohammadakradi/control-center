import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Control Center",
  description: "Manage and dispatch your Claude Code agents",
  applicationName: "Agent Platform",
  // Installed-app behaviour on iOS/iPadOS Safari, which ignores the manifest's `display`.
  appleWebApp: { capable: true, title: "Agent Platform", statusBarStyle: "black-translucent" },
  // Declared by path on purpose. The equivalent `app/apple-icon.png` file convention crashes
  // metadata rendering on EVERY page in this Next build ("ReferenceError: require is not
  // defined") — see the Next-16 notes in CLAUDE.md. `app/icon.svg` (the favicon) is fine.
  icons: { apple: "/icons/apple-touch-icon-180.png" },
};

/** The installed window's title-bar tint. Two entries so it tracks the OS scheme instead of
 *  hardcoding dark — the in-app light/dark/system toggle lives on `<html>` and can still
 *  disagree with the OS, which the standalone chrome can't follow. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      // The init script sets `class` and `data-*` on <html> before hydration.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the saved theme + sidebar width before first paint. Both are
            static constants — no interpolation, no user input. */}
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT + SIDEBAR_INIT_SCRIPT,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
