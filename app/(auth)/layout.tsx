export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight text-fg-strong">
            Control Center
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
