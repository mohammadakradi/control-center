"use client";

import { useEffect, useRef, useState } from "react";

/** Per-agent profile photo (currently only the SWE agent has one). */
const PHOTOS: Record<string, string> = {
  swe: "/swe-agent.png",
};

export function Avatar({
  namespace,
  size = 48,
}: {
  namespace: string;
  size?: number;
}) {
  const src = PHOTOS[namespace];
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // onError can miss failures that happen before hydration; re-check on mount.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setBroken(true);
  }, []);

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={ref}
        src={src}
        alt={`/${namespace} agent`}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full border border-neutral-700 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  // Fallback: initial on a neutral disc.
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 font-mono text-sky-300"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {namespace.charAt(0).toUpperCase()}
    </div>
  );
}
