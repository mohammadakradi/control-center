import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar, MobileTopBar } from "@/components/MobileNav";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Belt-and-suspenders: proxy.ts already redirects signed-out visitors before this
  // layout renders, but a server component shouldn't assume the middleware ran.
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  return (
    <div className="flex min-h-dvh">
      <Sidebar userEmail={user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar userEmail={user.email} />
        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:py-8 md:pb-14">
          {children}
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
