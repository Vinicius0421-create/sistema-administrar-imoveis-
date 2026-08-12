"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { UserStatus } from "@/lib/types/database";

// Desligamento/reativação de colaborador. requireRole já redireciona quem não
// é admin; a trigger prevent_privilege_escalation (0002_functions_triggers.sql)
// é a segunda camada — mesmo que este server action fosse contornado, o
// Postgres rejeitaria a alteração de status vinda de quem não é admin.
export async function setProfileStatus(profileId: string, status: UserStatus) {
  await requireRole("admin");

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ status }).eq("id", profileId);

  if (error) return { error: error.message };

  revalidatePath("/admin/colaboradores");
  revalidatePath("/admin/dashboard");
  return { error: null };
}

export async function setProfileRole(profileId: string, role: "colaborador" | "gestor" | "admin") {
  await requireRole("admin");

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", profileId);

  if (error) return { error: error.message };

  revalidatePath("/admin/colaboradores");
  return { error: null };
}
