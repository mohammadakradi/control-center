import Link from "next/link";

/** Where to send someone so they can act on the failure they were just shown. */
export type ErrorAction = { href: string; label: string };

/**
 * A failure message, optionally carrying the one link that resolves it.
 *
 * The link lives **inside** the `role="alert"` paragraph rather than beside it, and that is the
 * whole reason this is a component: an alert is a live region, so a sibling link is announced as
 * a second, separate event — the message and the way out arrive as one sentence only if they
 * share the element. Three call sites had already hand-rolled this (a dispatch refused because
 * the work is already running, and because the account has no Anthropic token), which is one
 * copy past where this project extracts a primitive.
 *
 * The link is distinguished by weight and an underline, never by colour: it inherits
 * `text-danger` from the paragraph, so it stays legible on `bg-danger-soft` in both themes
 * instead of putting an accent-blue link on a red wash.
 *
 * `className` is the caller's layout and density (`mt-2 text-xs`, `border-b bg-danger-soft
 * px-4 py-2 text-xs`, …), shaped like `buttonClasses()`/`fieldClasses()`. Renders nothing
 * without a message, so callers can pass state straight through.
 *
 * **Don't pass a text colour in `className`.** Two same-specificity colour utilities race in
 * the emitted stylesheet rather than resolving by their order in this string, so the winner
 * wouldn't be the caller's — the same trap `GettingStarted` hit with `border-*`. Density and
 * layout only.
 */
export function ErrorAlert({
  message,
  action,
  className = "",
}: {
  message: string | null | undefined;
  action?: ErrorAction | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p role="alert" className={`text-danger ${className}`}>
      {message}
      {action && (
        <>
          {" "}
          <Link href={action.href} className="font-medium underline">
            {action.label}
          </Link>
        </>
      )}
    </p>
  );
}
