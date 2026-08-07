"use client";

/**
 * Last-resort UI for an error in the root layout itself. It replaces the root layout when it
 * renders, so it carries its own `<html>`/`<body>` and pulls in the stylesheet — nothing above
 * it is left to inherit from.
 *
 * It also exists to make `next build` work at all. With no file here, Next prerenders its own
 * built-in `/_global-error`, and in this build that dies with
 * `TypeError: Cannot read properties of null (reading 'useContext')` — which failed the whole
 * build, which is why releases shipped `next dev` instead of a production build.
 *
 * Deliberately plain: no fonts, no providers, no data. Anything it depends on is another thing
 * that can be broken at the moment it is needed.
 */
import "./globals.css";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body className="min-h-full bg-surface text-fg">
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
          <div>
            <h1 className="text-lg font-semibold text-fg-strong">
              Agent Control Center hit an error
            </h1>
            <p className="mt-1 text-sm text-fg-subtle">
              The page couldn&apos;t be rendered. Your tasks and data are
              unaffected — this is the interface, not the agents.
            </p>
          </div>

          {/* The digest is what correlates this with the server log; the message itself is
              withheld in production builds, so without it there's nothing to go on. */}
          {error.digest && (
            <p className="font-mono text-xs text-fg-faint">
              digest {error.digest}
            </p>
          )}

          <div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg-strong"
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
