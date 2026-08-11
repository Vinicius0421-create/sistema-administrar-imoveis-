import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { perfilApi, Tema } from "../api/perfil";
import { useAuth } from "../auth/AuthContext";

// Preferências → Tema (10/07/2026, pedido do Vini: "crie preferências, não
// tem nenhuma" → confirmado como "tema do sistema e etc"). Antes disso o
// sistema só tinha tema claro fixo — este é o primeiro lugar do app com
// qualquer preferência pessoal de conta (ver placeholder estático que
// existia em MenuUsuario.tsx, deixado de propósito como recomendação
// futura na Etapa 3 da missão de Melhorias Adicionais).
//
// Fonte de verdade é o backend (GET/PATCH /perfil/preferencias, escopado ao
// usuário logado — mesma tabela PreferenciaUsuario, não confundir com
// PreferenciaNotificacao, que é sobre notificação e não sobre tema). O
// localStorage é só um cache otimista: aplicado ANTES do login terminar de
// carregar (ver aplicarTemaJaNoBoot em main.tsx) pra não piscar tema errado
// no primeiro frame, e reaplicado sempre que o backend confirma um valor
// diferente (ex: mesma conta logada em outro aparelho, que mudou o tema lá).
const LS_KEY = "administrar_imoveis_tema";

function lerTemaLocal(): Tema {
  const salvo = localStorage.getItem(LS_KEY);
  return salvo === "CLARO" || salvo === "ESCURO" || salvo === "SISTEMA" ? salvo : "SISTEMA";
}

function sistemaPrefereEscuro(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// Aplica a classe `dark` em <html> — chamada tanto pelo Provider quanto (via
// cópia inline, ver comentário em main.tsx) antes do React montar. Mantida
// exportada pra quem precisar reaplicar fora do ciclo de vida do Provider.
export function aplicarClasseDark(tema: Tema) {
  const escuro = tema === "ESCURO" || (tema === "SISTEMA" && sistemaPrefereEscuro());
  document.documentElement.classList.toggle("dark", escuro);
}

interface ThemeContextValue {
  tema: Tema;
  setTema: (tema: Tema) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [tema, setTemaState] = useState<Tema>(() => lerTemaLocal());

  // Reaplica a classe `dark` sempre que `tema` muda, e também quando o SO
  // muda de claro/escuro em tempo real (só importa quando tema === SISTEMA
  // — o listener fica montado sempre, mas só provoca reaplicação quando o
  // valor calculado de fato muda, já que aplicarClasseDark checa de novo).
  useEffect(() => {
    aplicarClasseDark(tema);
    if (tema !== "SISTEMA") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const ouvir = () => aplicarClasseDark(tema);
    mq.addEventListener("change", ouvir);
    return () => mq.removeEventListener("change", ouvir);
  }, [tema]);

  // Sincroniza com o backend assim que há sessão — é a fonte de verdade
  // (ex: mesma pessoa logada em outro aparelho já tinha mudado o tema lá).
  // Roda só uma vez por login (não a cada render), e nunca bloqueia a UI:
  // o valor do localStorage já foi aplicado no useState acima.
  useEffect(() => {
    if (!user) return;
    let cancelado = false;
    perfilApi
      .obterPreferencias()
      .then((pref) => {
        if (cancelado || !pref?.tema) return;
        localStorage.setItem(LS_KEY, pref.tema);
        setTemaState(pref.tema);
      })
      .catch(() => {
        // Sem preferência salva ainda, ou rede falhou — mantém o valor
        // local (default SISTEMA na primeira vez), sem travar a UI por
        // causa disso.
      });
    return () => {
      cancelado = true;
    };
  }, [user]);

  const setTema = useCallback(
    (novoTema: Tema) => {
      // Otimista: aplica na hora, sem esperar o PATCH confirmar — mudar de
      // tema é uma ação puramente visual, não há "erro de validação"
      // plausível que justifique esperar a rede pra refletir na tela.
      setTemaState(novoTema);
      localStorage.setItem(LS_KEY, novoTema);
      if (user) {
        perfilApi.atualizarPreferencias({ tema: novoTema }).catch(() => {
          // Falha ao persistir não desfaz a escolha visual — só significa
          // que, se a pessoa logar em outro aparelho antes de tentar de
          // novo aqui, pode ver o tema anterior. Baixo risco, não vale
          // reverter a UI por causa disso.
        });
      }
    },
    [user]
  );

  const value = useMemo(() => ({ tema, setTema }), [tema, setTema]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTema(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTema precisa estar dentro de <ThemeProvider>");
  return ctx;
}
