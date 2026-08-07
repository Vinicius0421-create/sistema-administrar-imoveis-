import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";
import { getSupabaseEnv } from "./env";

// Um client por request. Usado em Server Components, Server Actions e Route
// Handlers — nunca no browser. Todas as leituras/escritas passam pela RLS do
// Postgres com base na sessão do cookie, então mesmo que a aplicação erre,
// o banco nega acesso indevido.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Chamado a partir de um Server Component: a sessão já foi
          // atualizada pelo proxy (src/proxy.ts), então é seguro ignorar.
        }
      },
    },
  });
}
