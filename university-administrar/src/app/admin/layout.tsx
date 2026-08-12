import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { NavBar } from "@/components/domain/nav-bar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("admin", "gestor");

  return (
    <div className="flex min-h-svh flex-col bg-muted/20">
      <NavBar profile={profile} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8">
        <aside className="hidden w-48 shrink-0 space-y-1 sm:block">
          <Link
            href="/admin/dashboard"
            className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Dashboard
          </Link>
          {profile.role === "admin" ? (
            <Link
              href="/admin/treinamentos"
              className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              Treinamentos
            </Link>
          ) : null}
          <Link
            href="/admin/colaboradores"
            className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Colaboradores
          </Link>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
