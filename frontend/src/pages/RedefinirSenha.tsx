import React, { useState } from "react";
import { AUTH_BG_GRADIENT, Button, CARD_SHADOW_HOVER, Field, FONT_DISPLAY, PasswordInput } from "../components/ui";
import { LOGO_DATA_URI } from "../assets/logo";
import { authApi } from "../api/auth";
import { ApiError } from "../lib/apiClient";

// Tela 2 do fluxo "esqueci minha senha" self-service (07/07/2026, pedido do
// Vini) — aberta a partir do link recebido por e-mail
// (`/redefinir-senha?token=...`). Diferente do resto do app (que não tem
// router, é uma SPA de tela única — ver App.tsx), esta é a única rota que
// precisa de URL de verdade, porque é assim que o e-mail consegue "linkar"
// pra um lugar específico sem a pessoa estar logada.
export function RedefinirSenhaPage() {
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  const senhasConferem = novaSenha.length > 0 && novaSenha === confirmar;
  const senhaCurtaDemais = novaSenha.length > 0 && novaSenha.length < 8;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (novaSenha.length < 8) {
      setErro("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      setErro("As duas senhas digitadas são diferentes.");
      return;
    }
    setEnviando(true);
    try {
      await authApi.redefinirSenha(token, novaSenha);
      setConcluido(true);
    } catch (e) {
      // A mensagem de "link inválido ou expirado" (token errado, já usado,
      // ou passou de 1h) já vem pronta do backend — não precisa reescrever
      // aqui.
      setErro(e instanceof ApiError ? e.message : "Não foi possível redefinir a senha. Tente novamente.");
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
          <h1 className="text-lg" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800 }}>
            Redefinir senha
          </h1>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">Escolha uma senha nova para acessar o sistema.</p>
        </div>

        {!token ? (
          <div className="text-center">
            <div className="bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-800 rounded-xl p-4 mb-4">
              <p className="text-sm text-brand-700 dark:text-brand-400">
                Este link está incompleto ou inválido. Volte ao login e clique em "Esqueceu sua senha?" para pedir um
                novo.
              </p>
            </div>
            <Button variant="ghost" className="w-full justify-center" onClick={() => (window.location.href = "/")}>
              Voltar para o login
            </Button>
          </div>
        ) : concluido ? (
          <div className="text-center">
            <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 mb-4">
              <p className="text-sm text-emerald-800 dark:text-emerald-300">Senha redefinida com sucesso! Já pode entrar com a senha nova.</p>
            </div>
            <Button variant="accent" className="w-full justify-center" onClick={() => (window.location.href = "/")}>
              Ir para o login
            </Button>
          </div>
        ) : (
          <form onSubmit={submeter}>
            {erro && <div className="mb-4 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2.5">{erro}</div>}
            <Field label="Nova senha">
              <PasswordInput
                autoFocus
                required
                autoComplete="new-password"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
              />
              {senhaCurtaDemais && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Mínimo 8 caracteres.</p>}
            </Field>
            <Field label="Confirmar nova senha">
              <PasswordInput autoComplete="new-password" required value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
              {confirmar.length > 0 && !senhasConferem && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">As senhas não coincidem.</p>
              )}
            </Field>
            <Button
              type="submit"
              variant="accent"
              className="w-full justify-center mt-2"
              disabled={enviando || !senhasConferem || senhaCurtaDemais}
            >
              {enviando ? "Salvando..." : "Redefinir senha"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
