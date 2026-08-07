import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/auth";
import { tokenStore, refreshAccessToken, ApiError } from "../lib/apiClient";
import { Papel } from "../types";

interface AuthUser {
  id: string;
  email: string;
  papel: Papel;
  colaboradorId: string | null;
  precisaTrocarSenha: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  // true só durante a checagem inicial de sessão (boot do app); distinto de
  // `loading`, que é só do formulário de login. App.tsx usa este flag para
  // não desenhar a tela de Login por uma fração de segundo antes de saber
  // se existe uma sessão válida pra restaurar (ver `verificandoSessao` mais
  // abaixo e o uso em App.tsx).
  verificandoSessao: boolean;
  loading: boolean;
  erro: string | null;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
  trocarSenha: (senhaAtual: string, novaSenha: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregarUsuarioAtual = useCallback(async () => {
    const me = await authApi.me();
    setUser({
      id: me.id,
      email: me.email,
      papel: me.papel,
      colaboradorId: me.colaboradorId,
      precisaTrocarSenha: !!me.precisaTrocarSenha,
    });
  }, []);

  useEffect(() => {
    tokenStore.setUnauthorizedHandler(() => {
      // Achado em auditoria de 06/07/2026: antes disto, expirar a sessão
      // (ou o refresh falhar por sinal ruim) trocava pra tela de Login sem
      // nenhum aviso — o `erro` que a chamada original tentava mostrar
      // nunca chegava a aparecer, porque o componente que o exibiria já
      // tinha sido desmontado no mesmo ciclo em que `setUser(null)` troca
      // toda a árvore pro Login. Setar aqui, no nível do AuthProvider (que
      // nunca desmonta), garante que a mensagem sobrevive à troca de tela e
      // aparece exatamente no slot de erro que a LoginPage já tinha.
      //
      // Exceção: durante a checagem silenciosa de sessão no boot (F5 sem
      // sessão válida, ou primeira visita), isso NÃO é uma sessão expirando
      // de verdade — é só a ausência de uma pra restaurar. Mostrar "sua
      // sessão expirou" pra quem nunca fez login seria confuso.
      if (!verificandoSessaoRef.current) {
        setErro("Sua sessão expirou. Faça login novamente.");
      }
      setUser(null);
    });
    tokenStore.setSenhaTrocaObrigatoriaHandler(() => {
      setUser((atual) => (atual ? { ...atual, precisaTrocarSenha: true } : atual));
    });
  }, []);

  // Ref espelhando `verificandoSessao`: o handler acima é registrado uma
  // única vez (array de dependências vazio) mas precisa ler o valor mais
  // recente do flag no momento em que é disparado, não o valor congelado no
  // primeiro render — closures de useEffect com [] capturam só o estado
  // inicial.
  const verificandoSessaoRef = React.useRef(true);
  useEffect(() => {
    verificandoSessaoRef.current = verificandoSessao;
  }, [verificandoSessao]);

  // Persistência de Login (08/07/2026): no boot do app, tenta renovar
  // silenciosamente o access token usando o cookie httpOnly de refresh (se
  // existir e ainda for válido) — é isso que faz um F5 ou fechar/reabrir o
  // navegador continuar logado, resolvendo o bug relatado pelo Vini. Se não
  // houver cookie válido (nunca logou, ou o refresh expirou de vez — 7 dias
  // por padrão), simplesmente não restaura nada e a tela de Login aparece
  // normalmente, sem erro nenhum.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const renovou = await refreshAccessToken();
      if (cancelado) return;
      if (renovou) {
        try {
          await carregarUsuarioAtual();
        } catch {
          tokenStore.clear();
          setUser(null);
        }
      }
      if (!cancelado) setVerificandoSessao(false);
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, senha: string) => {
    setLoading(true);
    setErro(null);
    try {
      const resposta = await authApi.login(email, senha);
      tokenStore.set({ accessToken: resposta.accessToken });
      const me = await authApi.me();
      setUser({
        id: me.id,
        email: me.email,
        papel: me.papel,
        colaboradorId: me.colaboradorId,
        precisaTrocarSenha: !!me.precisaTrocarSenha,
      });
    } catch (e) {
      tokenStore.clear();
      setErro(e instanceof ApiError ? e.message : "Não foi possível entrar. Tente novamente.");
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const trocarSenha = useCallback(async (senhaAtual: string, novaSenha: string) => {
    const resposta = await authApi.trocarSenha(senhaAtual, novaSenha);
    tokenStore.setAccessToken(resposta.accessToken);
    setUser((atual) => (atual ? { ...atual, precisaTrocarSenha: false } : atual));
  }, []);

  const logout = useCallback(() => {
    // Best-effort: o backend revoga o refresh token (via cookie, enviado
    // automaticamente) e limpa o cookie no navegador. Se a chamada falhar
    // por rede, o access token expira sozinho em poucos minutos e o refresh
    // token no prazo configurado — a sessão local já foi encerrada de
    // qualquer forma pelas duas linhas abaixo.
    authApi.logout().catch(() => {});
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, verificandoSessao, loading, erro, login, logout, trocarSenha }),
    [user, verificandoSessao, loading, erro, login, logout, trocarSenha]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
