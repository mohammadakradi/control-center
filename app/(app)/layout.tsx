import { getSignedInUser } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar, MobileTopBar } from "@/components/MobileNav";
import { UpdateBanner } from "@/components/UpdateBanner";

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
      <Sidebar userEmail={signedIn?.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar userEmail={signedIn?.email} />
        {/* Renders nothing unless a packaged install is behind a published release. */}
        <UpdateBanner />
        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:py-8 md:pb-14">
          {children}
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
