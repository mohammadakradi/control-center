import type { Metadata } from "next";
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
  title: "Control Center",
  description: "Manage and dispatch your Claude Code agents",
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
