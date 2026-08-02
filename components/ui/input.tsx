import type { InputHTMLAttributes } from "react";

export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-fg-strong placeholder:text-fg-faint transition-colors outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:pointer-events-none disabled:opacity-50 ${className}`}
    />
  );
}
