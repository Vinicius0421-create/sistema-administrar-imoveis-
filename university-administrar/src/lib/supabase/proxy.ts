import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";
import { getSupabaseEnv } from "./env";

const PUBLIC_PATHS = ["/login"];

// Checagem otimista de sessão (ver guia de autenticação do Next.js): só lê o
// cookie de sessão e faz refresh de token, sem consultar o banco. A checagem
// de status "ativo/desativado" acontece na Data Access Layer (src/lib/dal.ts),
// que roda perto dos dados e é a linha de defesa real — o proxy só evita que
// usuários deslogados cheguem a páginas protegidas antes de a página carregar.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  let env: ReturnType<typeof getSupabaseEnv>;
  try {
    env = getSupabaseEnv();
  } catch {
    // Ambiente sem Supabase configurado (ex.: deploy novo antes de ligar o
    // banco): deixa a requisição passar em vez de derrubar o site inteiro
    // com 500 em toda rota. Páginas que realmente precisam do Supabase vão
    // falhar no próprio ponto de uso, com um erro específico daquele fluxo.
    return supabaseResponse;
  }
  const { url, anonKey } = env;
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicPath = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublicPath) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && path === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}
