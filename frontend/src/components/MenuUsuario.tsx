import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { perfilApi, PerfilResponse, SessaoAtiva, Tema } from "../api/perfil";
import { notificacoesApi } from "../api/notificacoes";
import { ApiError } from "../lib/apiClient";
import { Button, COLORS, Field, FONT_DISPLAY, LoadingState, Modal, PasswordInput, Spinner } from "./ui";
import { Camera, ChevronDown, Lock, LogOut, Monitor, Moon, Sun, Trash2, UserCircle2 } from "./icons";
import { PAPEL_LABEL, PreferenciaNotificacao } from "../types";
import { useTema } from "../theme/ThemeContext";
import { maskTelefone } from "../lib/mascaras";

// Item 3 da missão "Melhorias Adicionais" (08/07/2026, pedido do Vini):
// antes, o canto superior direito só mostrava e-mail + selo de papel +
// iniciais — sem nenhuma ação além do "Sair" escondido no rodapé da barra
// lateral. Este componente centraliza num único lugar: foto, dados
// pessoais (nome/cargo/setor/e-mail/telefone), troca de senha, sessões
// ativas ("segurança da conta") e logout. Substitui o bloco estático que
// vivia direto em App.tsx (ver AppShell) — App.tsx agora só renderiza
// <MenuUsuario />.

const TAMANHO_MAXIMO_FOTO_BYTES = 10 * 1024 * 1024; // mesmo teto do backend (ver utils/anexos.ts)

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// Busca a foto como Blob (precisa do header Authorization, que uma
// <img src> comum não manda) e expõe como object URL — mesmo raciocínio de
// apiDownloadBlob, documentado em lib/apiClient.ts. Hook próprio porque tanto
// o avatar do header quanto o cabeçalho do modal precisam do mesmo dado.
function useFotoPerfil(temFoto: boolean, versao: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let urlCriada: string | null = null;
    if (!temFoto) {
      setUrl(null);
      return;
    }
    setCarregando(true);
    perfilApi
      .baixarFoto()
      .then(({ blob }) => {
        if (cancelado) return;
        urlCriada = URL.createObjectURL(blob);
        setUrl(urlCriada);
      })
      .catch(() => {
        if (!cancelado) setUrl(null);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temFoto, versao]);

  return { url, carregando };
}

function Avatar({ iniciais, fotoUrl, size = 32 }: { iniciais: string; fotoUrl: string | null; size?: number }) {
  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt="Foto de perfil"
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, background: COLORS.chrome, fontSize: size * 0.4 }}
    >
      {iniciais}
    </div>
  );
}

export function MenuUsuario() {
  const { user, logout, trocarSenha } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [perfil, setPerfil] = useState<PerfilResponse | null>(null);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState<string | null>(null);
  const [fotoVersao, setFotoVersao] = useState(0);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessoes, setSessoes] = useState<SessaoAtiva[] | null>(null);
  const [carregandoSessoes, setCarregandoSessoes] = useState(false);
  const [processandoSessaoId, setProcessandoSessaoId] = useState<string | null>(null);

  const [mostrarFormSenha, setMostrarFormSenha] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [sucessoSenha, setSucessoSenha] = useState(false);
  const [enviandoSenha, setEnviandoSenha] = useState(false);

  // Preferências (10/07/2026, pedido do Vini: "crie preferências, não tem
  // nenhuma" → "tema do sistema e etc"). Tema vem do ThemeContext (ele
  // mesmo já cuida de aplicar/persistir); som/notificação no navegador
  // reaproveitam a tabela PreferenciaNotificacao, que já existia com rota
  // pronta desde a Central de Notificações (Fase B) mas nunca teve UI —
  // ver notificacoesApi.preferencias().
  const { tema, setTema } = useTema();
  const [prefNotificacao, setPrefNotificacao] = useState<PreferenciaNotificacao | null>(null);
  const [salvandoPrefNotificacao, setSalvandoPrefNotificacao] = useState(false);

  const carregarPrefNotificacao = useCallback(() => {
    notificacoesApi.preferencias().then(setPrefNotificacao).catch(() => {});
  }, []);

  async function alternarPrefNotificacao(campo: "som" | "notificacaoNavegador") {
    if (!prefNotificacao) return;
    const novoValor = !prefNotificacao[campo];
    // Otimista, igual ao Tema: alternar um som/aviso é reversível e de
    // baixo risco, não vale travar o clique esperando a rede confirmar.
    setPrefNotificacao({ ...prefNotificacao, [campo]: novoValor });
    setSalvandoPrefNotificacao(true);
    try {
      await notificacoesApi.atualizarPreferencias({ [campo]: novoValor });
    } catch {
      setPrefNotificacao((atual) => (atual ? { ...atual, [campo]: !novoValor } : atual));
    } finally {
      setSalvandoPrefNotificacao(false);
    }
  }

  const iniciais = (user?.email[0] || "?").toUpperCase();
  const { url: fotoUrl } = useFotoPerfil(!!perfil?.colaborador?.temFoto, fotoVersao);

  const carregarPerfil = useCallback(() => {
    setCarregandoPerfil(true);
    setErroPerfil(null);
    perfilApi
      .obter()
      .then(setPerfil)
      .catch((e) => setErroPerfil(e instanceof ApiError ? e.message : "Não foi possível carregar seu perfil."))
      .finally(() => setCarregandoPerfil(false));
  }, []);

  const carregarSessoes = useCallback(() => {
    setCarregandoSessoes(true);
    perfilApi
      .sessoes()
      .then(setSessoes)
      .catch(() => setSessoes(null))
      .finally(() => setCarregandoSessoes(false));
  }, []);

  // Carrega o perfil já ao montar (22/07/2026, achado do Vini: "quando eu
  // entro a foto de perfil não carrega instantaneamente, preciso clicar no
  // perfil pra carregar"). Antes, `perfil` só era buscado dentro de abrir()
  // — ou seja, só no clique pra abrir "Minha conta". Como o avatar do
  // cabeçalho (linha ~293, sempre visível) depende de `perfil.colaborador.
  // temFoto` pra saber se busca a foto (via useFotoPerfil), ele ficava preso
  // nas iniciais até esse primeiro clique. Buscando aqui, a foto real já
  // aparece assim que a sessão carrega, sem esperar nenhuma interação.
  useEffect(() => {
    if (user) carregarPerfil();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function abrir() {
    setAberto(true);
    carregarPerfil();
    carregarSessoes();
    carregarPrefNotificacao();
  }

  function fechar() {
    setAberto(false);
    // Reseta o formulário de senha ao fechar — reabrir o menu depois não deve
    // reaparecer com campos preenchidos de uma tentativa anterior.
    setMostrarFormSenha(false);
    setSenhaAtual("");
    setNovaSenha("");
    setConfirmarSenha("");
    setErroSenha(null);
    setSucessoSenha(false);
  }

  async function selecionarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois
    if (!file) return;
    setErroFoto(null);

    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setErroFoto("Envie uma imagem (JPEG, PNG, WEBP ou GIF).");
      return;
    }
    if (file.size > TAMANHO_MAXIMO_FOTO_BYTES) {
      setErroFoto(`Imagem excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_FOTO_BYTES / 1024 / 1024)}MB).`);
      return;
    }

    setEnviandoFoto(true);
    try {
      await perfilApi.enviarFoto(file);
      setPerfil((p) => (p?.colaborador ? { ...p, colaborador: { ...p.colaborador, temFoto: true } } : p));
      setFotoVersao((v) => v + 1);
    } catch (e) {
      setErroFoto(e instanceof ApiError ? e.message : "Não foi possível enviar a foto. Tente novamente.");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function removerFoto() {
    setEnviandoFoto(true);
    setErroFoto(null);
    try {
      await perfilApi.removerFoto();
      setPerfil((p) => (p?.colaborador ? { ...p, colaborador: { ...p.colaborador, temFoto: false } } : p));
      setFotoVersao((v) => v + 1);
    } catch (e) {
      setErroFoto(e instanceof ApiError ? e.message : "Não foi possível remover a foto.");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function submeterTrocaSenha(e: React.FormEvent) {
    e.preventDefault();
    setErroSenha(null);
    if (novaSenha.length < 8) {
      setErroSenha("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setErroSenha("As duas senhas digitadas são diferentes.");
      return;
    }
    setEnviandoSenha(true);
    try {
      await trocarSenha(senhaAtual, novaSenha);
      setSucessoSenha(true);
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmarSenha("");
      // A troca de senha revoga todos os refresh tokens existentes (ver
      // comentário em auth.routes.ts) — a lista de sessões ativas muda na
      // hora (só a atual continua valendo), então recarrega pra refletir.
      carregarSessoes();
    } catch (e) {
      setErroSenha(e instanceof ApiError ? e.message : "Não foi possível trocar a senha. Tente novamente.");
    } finally {
      setEnviandoSenha(false);
    }
  }

  async function encerrarSessao(id: string) {
    setProcessandoSessaoId(id);
    try {
      await perfilApi.encerrarSessao(id);
      setSessoes((atual) => atual?.filter((s) => s.id !== id) ?? atual);
    } catch {
      // Silencioso: se já não existir mais (expirada/revogada em outro
      // lugar entre o carregamento e o clique), recarregar a lista resolve.
      carregarSessoes();
    } finally {
      setProcessandoSessaoId(null);
    }
  }

  async function encerrarOutrasSessoes() {
    setProcessandoSessaoId("todas");
    try {
      await perfilApi.encerrarOutrasSessoes();
      carregarSessoes();
    } finally {
      setProcessandoSessaoId(null);
    }
  }

  if (!user) return null;

  const nomeExibido = perfil?.colaborador?.nomeCompleto || user.email;
  const senhasConferem = novaSenha.length > 0 && novaSenha === confirmarSenha;
  const senhaCurtaDemais = novaSenha.length > 0 && novaSenha.length < 8;
  const outrasSessoes = (sessoes ?? []).filter((s) => !s.atual);

  return (
    <>
      <button
        onClick={abrir}
        className="flex items-center gap-2.5 rounded-full pl-1 pr-1 sm:pr-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
        aria-haspopup="dialog"
      >
        <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">{user.email}</span>
        <span className="bg-slate-100 dark:bg-slate-800 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 tracking-wide hidden sm:inline">
          {PAPEL_LABEL[user.papel]}
        </span>
        <Avatar iniciais={iniciais} fotoUrl={fotoUrl} />
        <ChevronDown size={14} className="text-slate-400 dark:text-slate-500 hidden sm:inline" />
      </button>

      {aberto && (
        <Modal title="Minha conta" onClose={fechar} wide>
          {carregandoPerfil ? (
            <LoadingState text="Carregando seu perfil..." />
          ) : erroPerfil ? (
            <div className="text-sm text-brand-700 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-800 rounded-lg p-3">{erroPerfil}</div>
          ) : (
            <div className="space-y-6">
              {/* Cabeçalho: foto + identidade */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Avatar iniciais={iniciais} fotoUrl={fotoUrl} size={64} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={enviandoFoto || !perfil?.colaborador}
                    title={perfil?.colaborador ? "Trocar foto" : "Disponível só para contas vinculadas a um colaborador"}
                    className="absolute -bottom-1 -right-1 bg-slate-900 text-white rounded-full p-1.5 shadow-md hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
                  >
                    {enviandoFoto ? <Spinner size={13} /> : <Camera size={13} />}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={selecionarFoto} />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-900 dark:text-slate-100 truncate" style={{ fontFamily: FONT_DISPLAY }}>
                    {nomeExibido}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {[perfil?.colaborador?.cargo, perfil?.colaborador?.setor].filter(Boolean).join(" · ") || PAPEL_LABEL[user.papel]}
                  </p>
                  {fotoUrl && (
                    <button onClick={removerFoto} disabled={enviandoFoto} className="text-[11px] text-brand-700 dark:text-brand-400 hover:underline mt-1">
                      Remover foto
                    </button>
                  )}
                </div>
              </div>
              {erroFoto && <p className="text-xs text-brand-700 dark:text-brand-400 -mt-4">{erroFoto}</p>}
              {!perfil?.colaborador && (
                <p className="text-[11px] text-gray-500 dark:text-slate-400 -mt-4">
                  Sua conta não está vinculada a um cadastro de colaborador — foto, cargo, setor e telefone não estão disponíveis.
                </p>
              )}

              {/* Dados de contato */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Contato</h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[11px] text-gray-500 dark:text-slate-400">E-mail</dt>
                    <dd className="text-slate-900 dark:text-slate-100">{user.email}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-gray-500 dark:text-slate-400">Telefone</dt>
                    <dd className="text-slate-900 dark:text-slate-100">{perfil?.colaborador?.telefonePrincipal ? maskTelefone(perfil.colaborador.telefonePrincipal) : "—"}</dd>
                  </div>
                </dl>
              </div>

              {/* Segurança: troca de senha */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Segurança</h4>
                  {!mostrarFormSenha && (
                    <button onClick={() => setMostrarFormSenha(true)} className="text-xs text-brand-700 dark:text-brand-400 hover:underline flex items-center gap-1">
                      <Lock size={12} /> Alterar senha
                    </button>
                  )}
                </div>
                {mostrarFormSenha && (
                  <form onSubmit={submeterTrocaSenha} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-1">
                    {sucessoSenha ? (
                      <p className="text-sm text-emerald-700 dark:text-emerald-400">Senha alterada com sucesso. Suas outras sessões foram encerradas por segurança.</p>
                    ) : (
                      <>
                        {erroSenha && <p className="text-xs text-brand-700 dark:text-brand-400 mb-2">{erroSenha}</p>}
                        <Field label="Senha atual">
                          <PasswordInput autoComplete="current-password" required value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
                        </Field>
                        <Field label="Nova senha">
                          <PasswordInput autoComplete="new-password" required value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
                          {senhaCurtaDemais && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Mínimo 8 caracteres.</p>}
                        </Field>
                        <Field label="Confirmar nova senha">
                          <PasswordInput autoComplete="new-password" required value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)} />
                          {confirmarSenha.length > 0 && !senhasConferem && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">As senhas não coincidem.</p>}
                        </Field>
                        <div className="flex gap-2 pt-1">
                          <Button type="submit" variant="accent" disabled={enviandoSenha || !senhaAtual || !senhasConferem || senhaCurtaDemais}>
                            {enviandoSenha ? "Salvando..." : "Salvar nova senha"}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setMostrarFormSenha(false)}>
                            Cancelar
                          </Button>
                        </div>
                      </>
                    )}
                  </form>
                )}
              </div>

              {/* Sessões ativas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Sessões ativas</h4>
                  {outrasSessoes.length > 0 && (
                    <button
                      onClick={encerrarOutrasSessoes}
                      disabled={processandoSessaoId === "todas"}
                      className="text-xs text-brand-700 dark:text-brand-400 hover:underline disabled:opacity-50"
                    >
                      {processandoSessaoId === "todas" ? "Encerrando..." : "Encerrar todas as outras"}
                    </button>
                  )}
                </div>
                {carregandoSessoes ? (
                  <LoadingState text="Carregando sessões..." />
                ) : !sessoes || sessoes.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-slate-400">Nenhuma sessão ativa encontrada.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {sessoes.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <Monitor size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-slate-700 dark:text-slate-300">
                              Aberta em {fmtDataHora(s.criadoEm)}
                              {s.atual && <span className="ml-2 text-emerald-700 dark:text-emerald-400 font-semibold">· Esta sessão</span>}
                            </p>
                            <p className="text-[10px] text-gray-400">Expira em {fmtDataHora(s.expiraEm)}</p>
                          </div>
                        </div>
                        {!s.atual && (
                          <button
                            onClick={() => encerrarSessao(s.id)}
                            disabled={processandoSessaoId === s.id}
                            aria-label="Encerrar esta sessão"
                            title="Encerrar esta sessão"
                            className="text-gray-400 hover:text-brand-700 dark:hover:text-brand-400 flex-shrink-0 disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Preferências (10/07/2026, pedido do Vini: "crie
                  preferências, não tem nenhuma" → "tema do sistema e
                  etc"). Substituiu o placeholder estático da Etapa/Item 3
                  ("tema escuro fica como recomendação futura") — agora
                  implementado: tema (com suporte real a modo escuro em
                  todo o sistema, não só um botão decorativo) + som/aviso
                  de notificação, que já tinham rota pronta desde a Central
                  de Notificações mas nenhuma UI até agora. */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">Preferências</h4>

                <div className="mb-3">
                  <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1.5">Tema</span>
                  <div className="flex rounded-lg border border-gray-300 dark:border-slate-600 overflow-hidden text-xs">
                    {(
                      [
                        { valor: "CLARO" as Tema, label: "Claro", Icon: Sun },
                        { valor: "ESCURO" as Tema, label: "Escuro", Icon: Moon },
                        { valor: "SISTEMA" as Tema, label: "Sistema", Icon: Monitor },
                      ]
                    ).map(({ valor, label, Icon }) => (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => setTema(valor)}
                        aria-pressed={tema === valor}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 transition-colors ${
                          tema === valor
                            ? "text-white"
                            : "text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
                        }`}
                        style={tema === valor ? { background: COLORS.chrome } : undefined}
                      >
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5">
                  <label className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    Som ao receber notificação
                    <input
                      type="checkbox"
                      checked={prefNotificacao?.som ?? true}
                      disabled={!prefNotificacao || salvandoPrefNotificacao}
                      onChange={() => alternarPrefNotificacao("som")}
                      className="accent-brand-600"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    Notificação no navegador
                    <input
                      type="checkbox"
                      checked={prefNotificacao?.notificacaoNavegador ?? true}
                      disabled={!prefNotificacao || salvandoPrefNotificacao}
                      onChange={() => alternarPrefNotificacao("notificacaoNavegador")}
                      className="accent-brand-600"
                    />
                  </label>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-200 dark:border-slate-700">
                <Button variant="danger" onClick={logout} className="w-full justify-center">
                  <LogOut size={15} /> Sair da conta
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

// Reexportado só por conveniência de quem for montar telas de administração
// de colaborador que também queiram um avatar consistente (ex: Colaboradores.tsx
// no futuro) — não usado dentro deste arquivo além do próprio menu.
export { Avatar as AvatarUsuario, UserCircle2 };
