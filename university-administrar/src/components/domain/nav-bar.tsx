import Link from "next/link";
import { GraduationCap } from "lucide-react";
import type { Profile } from "@/lib/dal";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "./user-menu";

const roleLabel: Record<Profile["role"], string> = {
  colaborador: "Colaborador",
  gestor: "Gestor",
  admin: "Administrador",
};

export function NavBar({ profile }: { profile: Profile }) {
  const isStaff = profile.role === "admin" || profile.role === "gestor";

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <GraduationCap className="size-5" />
            University Administrar
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
            <Link href="/dashboard" className="hover:text-foreground">
              Painel
            </Link>
            <Link href="/treinamentos" className="hover:text-foreground">
              Treinamentos
            </Link>
            <Link href="/historico" className="hover:text-foreground">
              Histórico
            </Link>
            {isStaff ? (
              <Link href="/admin/dashboard" className="hover:text-foreground">
                Painel Admin
              </Link>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {roleLabel[profile.role]}
          </Badge>
          <UserMenu profile={profile} />
        </div>
      </div>
    </header>
  );
}
