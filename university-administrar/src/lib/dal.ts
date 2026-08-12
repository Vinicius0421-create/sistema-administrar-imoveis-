import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Fonte única da verdade de autorização: toda leitura de dados sensíveis desta
// aplicação passa por getCurrentProfile(), não só o proxy (checagem
// otimista) e não só o layout (não roda em toda navegação — client-side
// transitions podem pular layouts, ver docs do Next.js). Memoizado por
// requisição via React cache.
export const getCurrentProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/login");
  }

  // Desligamento automático: mesmo com sessão válida no Supabase Auth, um
  // colaborador desativado é barrado aqui, no servidor, antes de qualquer
  // dado ser retornado — não depende do proxy nem do frontend.
  if (profile.status !== "ativo") {
    await supabase.auth.signOut();
    redirect("/login?desativado=1");
  }

  return profile;
});

export async function requireRole(...roles: Profile["role"][]) {
  const profile = await getCurrentProfile();
  if (!roles.includes(profile.role)) {
    redirect("/");
  }
  return profile;
}
