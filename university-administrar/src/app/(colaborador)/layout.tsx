import { getCurrentProfile } from "@/lib/dal";
import { NavBar } from "@/components/domain/nav-bar";

export default async function ColaboradorLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  return (
    <div className="flex min-h-svh flex-col bg-muted/20">
      <NavBar profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
