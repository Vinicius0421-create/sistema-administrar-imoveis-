import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider, aplicarClasseDark } from "./theme/ThemeContext";
import { FeedbackProvider } from "./contexts/FeedbackContext";
import { ErrorBoundary } from "./components/ui";
// Fonte de destaque da Fase 5 (Identidade Visual) — self-hosted via
// @fontsource (sem chamada externa a fonts.googleapis.com em runtime, então
// não depende de rede liberada em produção nem vaza dado de visita pro
// Google). Peso variável único cobre todos os pesos usados (400 a 800).
import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";

// Sem VITE_SENTRY_DSN configurado no build (Vercel), isto não faz nada —
// nenhum comportamento muda pra quem não configurar. Ver ErrorBoundary em
// components/ui.tsx, que reporta pro Sentry quando a captura acontece.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

// Preferências → Tema (10/07/2026): aplica a classe `dark` em <html> ANTES
// do React montar qualquer coisa, lendo direto do localStorage (o mesmo
// valor que ThemeProvider vai ler de novo logo em seguida pro estado do
// React — ver theme/ThemeContext.tsx). Sem isso, toda vez que alguém com
// tema escuro salvo desse F5, veria um flash de tela clara por uma fração
// de segundo antes do useEffect do Provider rodar — mesma classe de
// problema que "Persistência de Login" resolveu pro estado de sessão
// (ver comentário em App.tsx).
try {
  const salvo = localStorage.getItem("administrar_imoveis_tema");
  const tema = salvo === "CLARO" || salvo === "ESCURO" || salvo === "SISTEMA" ? salvo : "SISTEMA";
  aplicarClasseDark(tema);
} catch {
  // localStorage indisponível (modo privado restritivo, etc.) — sem tema
  // salvo, mantém o padrão claro do :root em index.css.
}

// Achado de auditoria (06/07/2026): o ErrorBoundary só existia dentro de
// cada módulo (ver App.tsx) — um erro fora desse escopo (no próprio
// AuthProvider, no shell do App antes de renderizar um módulo, etc.)
// derrubava a tela inteira em branco, sem chance nenhuma de "Tentar
// novamente". Este boundary de topo é a rede de segurança final.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <FeedbackProvider>
            <App />
          </FeedbackProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
