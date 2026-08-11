import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AUTH_BG_GRADIENT, Button, CARD_SHADOW_HOVER, Field, FONT_DISPLAY, PasswordInput, TextInput } from "../components/ui";
import { LOGO_DATA_URI } from "../assets/logo";
import { authApi } from "../api/auth";
import { ApiError } from "../lib/apiClient";

export function LoginPage() {
  const { login, loading, erro } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  // "Esqueci minha senha" self-service (07/07/2026, pedido do Vini — evitar
  // que todo esquecimento vire mensagem pro administrador). Fica como um
  // segundo "modo" da mesma tela em vez de uma rota própria — é só um
  // formulário de um campo, não precisa de URL compartilhável (diferente da
  // tela de Redefinir Senha, que só existe porque o link do e-mail precisa
  // apontar pra algum lugar).
  const [modo, setModo] = useState<"login" | "esqueci-senha">("login");

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    login(email, senha).catch(() => {
      // erro já fica disponível via useAuth().erro
    });
  }

  if (modo === "esqueci-senha") {
    return <EsqueciSenhaForm emailInicial={email} onVoltar={() => setModo("login")} />;
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: AUTH_BG_GRADIENT }}
    >
      <form
        onSubmit={submeter}
        className="w-full max-w-sm bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-7"
        style={{ boxShadow: "var(--elevation-3)" }}
      >
        <div className="text-center mb-7">
          <div className="inline-flex bg-slate-900 rounded-2xl p-3.5 mb-3.5 shadow-lg shadow-slate-900/20">
            <img src={LOGO_DATA_URI} alt="Administrar Imóveis" className="h-9" />
          </div>
          <h1 className="text-xl" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800 }}>
            <span className="text-slate-900 dark:text-slate-100">ADMINISTRAR</span> <span className="text-brand-600">IMÓVEIS</span>
          </h1>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">Sistema Organizacional — acesso restrito</p>
        </div>

        {erro && <div className="mb-4 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2.5">{erro}</div>}

        <Field label="E-mail">
          <TextInput
            type="email"
            autoFocus
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@administrarimoveis.com.br"
          />
        </Field>
        <Field label="Senha">
          <PasswordInput autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Field>
        <Button type="submit" variant="accent" className="w-full justify-center mt-3" disabled={loading || !email || !senha}>
          {loading ? "Entrando..." : "Entrar"}
        </Button>
        {/* Substituído em 07/07/2026 (pedido do Vini) pelo fluxo self-service
            real — antes disto, a única saída era "fale com o administrador",
            registrado como achado de auditoria em 06/07/2026 justamente
            porque não existia nada além disso. */}
        <button
          type="button"
          onClick={() => setModo("esqueci-senha")}
          className="block w-full text-center text-xs text-gray-500 dark:text-slate-400 hover:text-brand-600 mt-4"
        >
          Esqueceu sua senha?
        </button>
      </form>
    </div>
  );
}

// Tela 1 do fluxo self-service: só pede o e-mail e dispara o pedido. Sempre
// mostra a mesma mensagem de sucesso (exista ou não o e-mail, tenha
// funcionado ou não o envio) — o backend já garante isso (ver comentário em
// auth.routes.ts), aqui só reflete a mesma resposta genérica na tela.
function EsqueciSenhaForm({ emailInicial, onVoltar }: { emailInicial: string; onVoltar: () => void }) {
  const [email, setEmail] = useState(emailInicial);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await authApi.esqueciSenha(email);
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: AUTH_BG_GRADIENT }}
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-7" style={{ boxShadow: "var(--elevation-3)" }}>
        <div className="text-center mb-7">
          <div className="inline-flex bg-slate-900 rounded-2xl p-3.5 mb-3.5 shadow-lg shadow-slate-900/20">
            <img src={LOGO_DATA_URI} alt="Administrar Imóveis" className="h-9" />
          </div>
          <h1 className="text-xl text-slate-900 dark:text-slate-100" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800 }}>
            Esqueceu sua senha?
          </h1>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">
            Informe seu e-mail cadastrado e enviamos um link para você escolher uma senha nova.
          </p>
        </div>

        {enviado ? (
          <div className="text-center">
            <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 mb-4">
              <p className="text-sm text-emerald-800 dark:text-emerald-300">
                Se este e-mail estiver cadastrado, você vai receber um link de redefinição em instantes — confira também
                a caixa de spam.
              </p>
            </div>
            <Button variant="ghost" className="w-full justify-center" onClick={onVoltar}>
              Voltar para o login
            </Button>
          </div>
        ) : (
          <form onSubmit={enviar}>
            {erro && <div className="mb-4 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2.5">{erro}</div>}
            <Field label="E-mail">
              <TextInput
                type="email"
                autoFocus
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@administrarimoveis.com.br"
              />
            </Field>
            <Button type="submit" variant="accent" className="w-full justify-center mt-3" disabled={enviando || !email}>
              {enviando ? "Enviando..." : "Enviar link de redefinição"}
            </Button>
            <button
              type="button"
              onClick={onVoltar}
              className="block w-full text-center text-xs text-gray-500 dark:text-slate-400 hover:text-brand-600 mt-4"
            >
              Voltar para o login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
