import { getSignedInUser } from "@/lib/auth";
import { APP_VERSION } from "@/lib/version";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar, MobileTopBar } from "@/components/MobileNav";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ActivityBadge } from "@/components/ActivityBadge";
import { Toaster } from "@/components/Toaster";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Sign-in is optional — no redirect. A visitor without a session is the local workspace,
  // which owns its own tasks and token. This only asks *whether* they're signed in, so the
  // chrome can say whose data is on screen and offer signing in; keeping one person's tasks
  // away from another's is enforced in the queries (lib/task-access.ts), not here.
  const signedIn = await getSignedInUser();

  return (
    <div className="flex min-h-dvh">
      <Sidebar userEmail={signedIn?.email} version={APP_VERSION} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar userEmail={signedIn?.email} />
        {/* Renders nothing unless a packaged install is behind a published release. */}
        <UpdateBanner />
        {/* The running-task badge gets its own sticky row on desktop rather than floating in
            the corner: pinned to the corner it would cover `PageHeader`'s actions (/usage's
            range switcher, /backlog's "Add item") at every width from `md` up. It renders
            nothing while nothing is running, and this row has no padding of its own, so an
            idle app is byte-for-byte the layout it was before. Below `md` the badge lives in
            `MobileTopBar` instead — a phone can't spare a second strip of chrome. */}
        <div className="sticky top-0 z-30 mx-auto hidden w-full max-w-6xl justify-end px-4 sm:px-6 md:flex">
          <ActivityBadge className="my-2" />
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:py-8 md:pb-14">
          {children}
        </main>
      </div>
      <MobileTabBar />
      {/* Last child on purpose. Toasts and `Modal` are both `z-50`, so DOM order is what
          decides which floats over the other — and a notice that a gate is waiting is exactly
          the thing that must not end up behind a modal scrim. */}
      <Toaster />
    </div>
  );
}
