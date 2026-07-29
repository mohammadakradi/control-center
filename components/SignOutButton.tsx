"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function SignOutButton({
  className = "",
  iconOnly = false,
}: {
  className?: string;
  /** Renders just the icon (for tight spaces like the mobile top bar). */
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      router.push("/signin");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label="Sign out"
      title="Sign out"
      className={`inline-flex items-center gap-3 rounded-lg text-fg-faint transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 ${className}`}
    >
      <LogOut className="size-4.5 shrink-0" aria-hidden="true" />
      {!iconOnly && <span>Sign out</span>}
    </button>
  );
}
