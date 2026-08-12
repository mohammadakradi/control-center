import type { InputHTMLAttributes } from "react";

/** The look of a form field. Exported because a `<textarea>` has to match an `<input>`
 *  exactly and there is no reason for two copies of the same border/focus treatment. */
export const fieldClasses =
  "w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-fg-strong placeholder:text-fg-faint transition-colors outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:pointer-events-none disabled:opacity-50";

export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${fieldClasses} ${className}`} />;
}
