import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AUTH_BG_GRADIENT, Button, CARD_SHADOW_HOVER, Field, FONT_DISPLAY, PasswordInput } from "../components/ui";
import { LOGO_DATA_URI } from "../assets/logo";
import { ApiError } from "../lib/apiClient";

// Tela obrigatória: aparece sempre que o login usa uma senha temporária
// (provisionamento em lote) e ainda não foi trocada por uma senha própria.
// Enquanto isso, a API bloqueia qualquer outra rota (ver src/plugins/auth.ts
// no backend) — então não tem como "pular" essa etapa navegando direto.
export function TrocarSenhaObrigatoriaPage() {
  const { user, trocarSenha, logout } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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
      await trocarSenha(senhaAtual, novaSenha);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível trocar a senha. Tente novamente.");
    } finally {
      setEnviando(false);
    }
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
          <h1 className="text-lg" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800 }}>
            Defina sua senha
          </h1>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">
            {user?.email} — sua senha atual é temporária. Escolha uma senha só sua para continuar.
          </p>
        </div>

        {erro && <div className="mb-4 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2.5">{erro}</div>}

        <Field label="Senha temporária (recebida da empresa)">
          <PasswordInput
            autoFocus
            required
            autoComplete="current-password"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
          />
        </Field>
        <Field label="Nova senha (só sua)">
          <PasswordInput autoComplete="new-password" required value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
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
          disabled={enviando || !senhaAtual || !senhasConferem || senhaCurtaDemais}
        >
          {enviando ? "Salvando..." : "Salvar e entrar"}
        </Button>
        <button
          type="button"
          onClick={logout}
          className="w-full text-center text-xs text-slate-500 dark:text-slate-400 hover:text-slate-600 mt-3"
        >
          Sair
        </button>
      </form>
    </div>
  );
}
