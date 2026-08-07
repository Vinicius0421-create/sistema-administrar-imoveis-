import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppData } from "../hooks/useAppData";
import {
  mensagensApi,
  favoritosApi,
  fixadosApi,
  reacoesApi,
  arquivosCompartilhadosApi,
  preferenciasNotificacaoCanalApi,
  Mensagem,
  ConversaResumo,
  AutorMensagem,
  CanaisDisponiveis,
  Favorito,
  PreferenciaNotificacaoCanal,
  TipoMensagem,
  TipoCanalUrl,
  ModoNotificacaoCanal,
  EmojiReacao,
  EMOJIS_REACAO_PERMITIDOS,
  tipoParaUrl,
  tipoParaUrlConversa,
  chaveSetorUnidade,
  CANAL_EMPRESA_ID,
} from "../api/mensagens";
import { presencaApi, StatusPresenca } from "../api/presenca";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/apiClient";
import { Button, EmptyState, LoadingState, Modal, SearchBox, Spinner, TextArea } from "../components/ui";
import {
  MessageCircle,
  Send,
  Paperclip,
  Download,
  Lock,
  X,
  ArrowLeft,
  Star,
  Megaphone,
  Building2,
  ChevronDown,
  ChevronRight,
  Pin,
  Smile,
  CornerUpLeft,
  Search,
  Bell,
  BellOff,
  CheckCheck,
  Eye,
  Plus,
  Folder,
  MoreHorizontal,
  Settings,
} from "../components/icons";
// M4 do check-up (Fase 2, 22/07/2026) — ponte SSE genérica pra este módulo
// (ver comentário completo em lib/mensagensRealtime.ts): App.tsx repassa o
// evento "dados" do backend pra cá quando inclui "mensagens" entre as
// entidades avisadas (ver avisarMudanca("mensagens") em mensagens.routes.ts).
import { assinarMensagensAtualizadas } from "../lib/mensagensRealtime";

// Chat interno (07/07/2026, pedido do Vini: "criar um jeito de conversar
// entre os usuários" — escolheu, entre as opções apresentadas, "direto +
// canais por unidade/setor" sem WebSocket). Busca por polling simples: a
// conversa aberta e a lista de conversas recarregam a cada POLL_MS.
//
// Redesenho completo da Central de Comunicação (Fase 1, 21/07/2026, pedido
// do Vini: organização 100% automática por permissão, "cada colaborador
// visualize apenas os canais realmente relevantes para sua função, unidade
// e setor"). Reescrita por completo nesta rodada:
//   - Barra lateral com 3 abas: Recentes (conversas + canais com atividade,
//     igual antes), Canais (árvore 📁 Unidade > 📂 Setor + setores globais
//     tipo TI/RH + 📣 Avisos da Empresa — vem pronta do backend em
//     GET /mensagens/canais-disponiveis, já filtrada por permissão) e
//     ⭐ Favoritos (ver FavoritoConversa em schema.prisma).
//   - 2 tipos de canal novos: CANAL_SETOR_UNIDADE ("meu departamento", de
//     verdade restrito a 1 unidade — resolve o bug relatado de colaborador
//     de Locação/Itaúna enxergar Locação/Igarapé) e CANAL_EMPRESA (avisos
//     gerais, singleton). Ver comentário completo em mensagens.routes.ts.
//   - Busca de "Nova conversa" passa a filtrar também por setor/unidade/
//     cargo do colaborador, não só pelo nome.
//
// SSE como caminho rápido (achado M4 do check-up, 22/07/2026): até aqui,
// este era o único módulo do sistema sem `avisarMudanca` no backend (ver
// mensagens.routes.ts) — a lista de conversas e a thread aberta só
// atualizavam com mudança de outra pessoa depois de até 8s de polling. Agora
// o backend empurra um evento SSE "mensagens" a cada envio/reação/fixação
// (mesma conexão SSE que já alimenta o sino, ver assinarMensagensAtualizadas
// abaixo), e o polling vira só rede de segurança — por isso o intervalo
// sobe bastante (era 8s, cobre o caso de rede que bloqueia SSE por completo
// ou o intervalo antes da 1ª conexão SSE completar).
const POLL_MS = 45000;

const ANEXO_MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"]);
const ANEXO_TAMANHO_MAXIMO = 20 * 1024 * 1024;

function fmtTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Preview inline do anexo — imagem/vídeo viram mídia embutida, qualquer
// outro tipo (não deveria acontecer, mas por segurança) vira link de
// download. Busca o arquivo como Blob autenticado (mesmo padrão de
// AnexoEvento em ChamadoDetalhe.tsx) porque uma <img>/<video> comum não
// manda o header Authorization sozinha.
function AnexoMensagem({ mensagem }: { mensagem: Mensagem }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const ehImagem = (mensagem.anexoTipo || "").startsWith("image/");
  const ehVideo = (mensagem.anexoTipo || "").startsWith("video/");

  useEffect(() => {
    let ativo = true;
    let urlCriada: string | null = null;
    mensagensApi
      .baixarAnexo(mensagem.id)
      .then(({ blob }) => {
        if (!ativo) return;
        urlCriada = URL.createObjectURL(blob);
        setUrl(urlCriada);
      })
      .catch(() => {})
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagem.id]);

  if (carregando) {
    return (
      <div className="h-24 w-40 flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-slate-500 bg-black/5 rounded-lg mb-1 animate-[fadeIn_var(--motion-fast)_ease-out]">
        <Spinner size={14} /> Carregando...
      </div>
    );
  }
  if (!url) return <p className="text-xs opacity-70 mb-1">Não foi possível carregar o anexo.</p>;

  if (ehImagem) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mb-1">
        <img src={url} alt={mensagem.anexoNomeOriginal || "Anexo"} className="max-h-52 rounded-[var(--radius-control)] border border-black/10" />
      </a>
    );
  }
  if (ehVideo) {
    return <video src={url} controls className="max-h-52 rounded-[var(--radius-control)] border border-black/10 mb-1" />;
  }
  return (
    <a href={url} download={mensagem.anexoNomeOriginal || "anexo"} className="flex items-center gap-1.5 text-xs underline mb-1">
      <Download size={13} /> {mensagem.anexoNomeOriginal || "Anexo"}
    </a>
  );
}

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function nomeExibicao(pessoa: AutorMensagem): string {
  return pessoa.colaborador?.nomeCompleto || pessoa.email;
}

// Prefixo visual por tipo de canal na lista — DIRETA não leva prefixo (é uma
// pessoa), CANAL_EMPRESA leva 📣 (é avisos gerais), os demais levam "#"
// (convenção de canal, igual Slack/Teams).
function prefixoNome(tipo: TipoMensagem, nome: string): string {
  if (tipo === "DIRETA") return nome;
  if (tipo === "CANAL_EMPRESA") return `📣 ${nome}`;
  return `# ${nome}`;
}

// Menções (@) (Fase 2, 21/07/2026) — mesma regex/formato do backend (ver
// utils/mencoes.ts): `@[Nome Completo](usuarioId)`. Aqui só pra RENDERIZAR
// (trocar pelo "@Nome" estilizado); inserir o token é feito pelo
// autocomplete no compose, abaixo.
const REGEX_MENCAO = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g;

function renderConteudoComMencoes(conteudo: string, meuId?: string): React.ReactNode {
  const partes: React.ReactNode[] = [];
  let ultimoIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(REGEX_MENCAO);
  let i = 0;
  while ((match = regex.exec(conteudo))) {
    if (match.index > ultimoIndex) partes.push(conteudo.slice(ultimoIndex, match.index));
    const souEuMencionado = match[2] === meuId;
    partes.push(
      <span
        key={`mencao-${i++}`}
        className={`font-semibold rounded px-0.5 ${souEuMencionado ? "bg-amber-200/60 text-amber-900 dark:bg-amber-500/25 dark:text-amber-300" : "bg-brand-100/70 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"}`}
      >
        @{match[1]}
      </span>
    );
    ultimoIndex = match.index + match[0].length;
  }
  if (ultimoIndex < conteudo.length) partes.push(conteudo.slice(ultimoIndex));
  return partes;
}

// Versão em texto puro de uma menção (22/07/2026, achado do Vini ao
// revisar o chat: a prévia da lista de conversas — "Gabriel Santos de
// Novaes / @[Gabriel Santos de Novaes](cmr5kwbnn...)" — mostrava o token
// cru da menção em vez do nome. `renderConteudoComMencoes` acima resolve
// isso dentro da conversa aberta (troca por um "chip" estilizado), mas
// esses lugares só têm espaço pra uma linha de texto simples truncado —
// aqui só troca `@[Nome](id)` por `@Nome`, sem nenhuma marcação.
function textoSemMencoes(conteudo: string): string {
  return conteudo.replace(REGEX_MENCAO, "@$1");
}

// Bolinha de presença (Fase 2, 21/07/2026, pedido do Vini: "status online" e
// "status ausente") — verde (online), âmbar (ausente), sem bolinha nenhuma
// (offline ou status ainda não carregado) pra não poluir a UI com cinza em
// toda linha.
function PresencaDot({ status }: { status?: StatusPresenca }) {
  if (!status || status === "offline") return null;
  const cor = status === "online" ? "bg-emerald-500" : "bg-amber-400";
  const titulo = status === "online" ? "Online" : "Ausente";
  return <span className={`inline-block w-2 h-2 rounded-full ${cor} flex-shrink-0`} title={titulo} aria-label={titulo} />;
}

// Chave usada pra mapear a preferência de notificação de UMA conversa —
// mesmo formato de chaveFavorito, reaproveitado aqui porque é literalmente
// a mesma convenção tipo:alvoId (ver comentário em canaisMensagem.ts).
function chavePreferencia(tipo: TipoMensagem, alvoId: string): string {
  return `${tipo}:${alvoId}`;
}

type Alvo = { tipo: "DIRETA"; usuarioId: string; nome: string } | { tipo: Exclude<TipoMensagem, "DIRETA">; id: string; nome: string };

function mesmoAlvo(a: Alvo | null, b: Alvo | null): boolean {
  if (!a || !b) return a === b;
  if (a.tipo !== b.tipo) return false;
  if (a.tipo === "DIRETA" && b.tipo === "DIRETA") return a.usuarioId === b.usuarioId;
  if (a.tipo !== "DIRETA" && b.tipo !== "DIRETA") return a.id === b.id;
  return false;
}

// Chave usada tanto em Alvo→favorito quanto pra checar "isto está
// favoritado" — sempre `tipo:alvoId`, onde alvoId é usuarioId (DIRETA) ou
// o id de canal de sempre (unidade/setor/chaveSetorUnidade/CANAL_EMPRESA_ID).
function chaveFavorito(tipo: TipoMensagem, alvoId: string): string {
  return `${tipo}:${alvoId}`;
}

function alvoParaFavorito(a: Alvo): { tipo: TipoMensagem; alvoId: string } {
  return a.tipo === "DIRETA" ? { tipo: "DIRETA", alvoId: a.usuarioId } : { tipo: a.tipo, alvoId: a.id };
}

interface Props {
  data: AppData;
  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — id de
  // Usuario de quem mandou uma mensagem DIRETA (só esse tipo notifica, ver
  // comentário em mensagens.routes.ts). `undefined` = comportamento normal
  // (nenhuma conversa pré-selecionada). Repassado como prop em vez de lido
  // só na montagem porque este mesmo componente pode continuar montado
  // entre um clique e outro (ex: usuário já está na aba Mensagens e clica
  // num pop-up de outra pessoa) — o `useEffect` abaixo reage a toda troca de
  // valor, não só à primeira.
  abrirConversaComUsuarioId?: string;
  // Mesma ideia, pra mensagem de canal — `tipo` cobre os 4 tipos de canal
  // hoje existentes (ver TipoCanalUrl em api/mensagens.ts).
  abrirCanal?: { tipo: TipoCanalUrl; id: string };
  // Achado de auditoria C7 (22/07/2026): "Acesso extra a canal do chat" (dar
  // a um setor/pessoa acesso a um canal fora do próprio setor/unidade, ex:
  // Locação acompanhando Sucesso do Cliente) só existe dentro de
  // Configurações — nada em Mensagens dava a entender que essa opção existe
  // ali, então só quem já sabia da tela ia procurar. Link cruzado: um botão
  // aqui (só ADMINISTRADOR, mesmo gate de "Visualizar como" ao lado) leva
  // direto pra Configurações; sem router de verdade nesta SPA (ver App.tsx),
  // a navegação em si só o AppShell sabe fazer (troca `activeModule`), por
  // isso entra como callback em vez de um <a href>.
  onIrParaConfiguracoes?: () => void;
}

export function MensagensPage({ data, abrirConversaComUsuarioId, abrirCanal, onIrParaConfiguracoes }: Props) {
  const { user } = useAuth();
  const [aba, setAba] = useState<"conversas" | "canais" | "favoritos">("conversas");
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [carregandoConversas, setCarregandoConversas] = useState(true);
  // Achado M3 do check-up (Fase 2, 22/07/2026) — antes, uma falha de rede/
  // servidor ao buscar conversas caía no MESMO estado vazio de "você não tem
  // conversa nenhuma ainda" (ver render abaixo), sem diferenciar "não tenho
  // nada" de "algo quebrou". Só usado quando a lista está vazia (ver render):
  // uma falha de poll em segundo plano com a lista já carregada não deve
  // substituir dado bom por uma mensagem de erro — mesmo racional do
  // try/catch de refetch em useAppData.ts.
  const [erroConversas, setErroConversas] = useState<string | null>(null);
  const [canais, setCanais] = useState<CanaisDisponiveis | null>(null);
  // "Visualizar como" (22/07/2026) — só ADMINISTRADOR. A própria conta de
  // Administrador é irrestrita por desenho (ver comentário completo em
  // canaisMensagem.ts) — sempre vê toda unidade/todo setor, mesmo depois da
  // segmentação de canais ser corrigida. Este modal deixa conferir a árvore
  // de canais de QUALQUER outro usuário (Gestor/Financeiro/Colaborador) sem
  // precisar da senha dele, pra confirmar visualmente que a restrição está
  // certa.
  const [visualizarComoAberto, setVisualizarComoAberto] = useState(false);
  const [favoritos, setFavoritos] = useState<Favorito[]>([]);
  const [unidadesAbertas, setUnidadesAbertas] = useState<Set<string>>(new Set());
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregandoThread, setCarregandoThread] = useState(false);
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscaContato, setBuscaContato] = useState("");
  // Botão "+ Nova conversa" em vez de campo de busca fixo (22/07/2026,
  // pedido do Vini: o campo de busca sempre visível no rodapé da lista
  // "Recentes" ocupava espaço permanente pra uma ação usada só de vez em
  // quando). Agora `buscaContato`/`contatosFiltrados` só aparecem dentro
  // deste modal, aberto sob demanda.
  const [novaConversaAberta, setNovaConversaAberta] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);
  const alvoRef = useRef<Alvo | null>(null);
  alvoRef.current = alvo;
  const buscaHistoricoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Fase 2 da Central de Comunicação (21/07/2026) ----

  // Resposta em thread — mensagem sendo respondida (preview acima do
  // compose) e o painel de thread aberto (respostas de UMA mensagem).
  const [respondendoA, setRespondendoA] = useState<Mensagem | null>(null);
  const [threadAberta, setThreadAberta] = useState<Mensagem | null>(null);
  const [threadRespostas, setThreadRespostas] = useState<Mensagem[]>([]);
  const [carregandoThreadPainel, setCarregandoThreadPainel] = useState(false);
  const [textoThread, setTextoThread] = useState("");
  const [enviandoThread, setEnviandoThread] = useState(false);

  // Mensagens fixadas — barra colapsável no topo da conversa aberta.
  const [fixadas, setFixadas] = useState<Mensagem[]>([]);
  const [fixadasAbertas, setFixadasAbertas] = useState(false);

  // Arquivos compartilhados — painel sob demanda (clique no ícone de anexo
  // do cabeçalho), não carregado até o usuário pedir.
  const [arquivosPainelAberto, setArquivosPainelAberto] = useState(false);
  const [arquivosCompartilhados, setArquivosCompartilhados] = useState<Mensagem[]>([]);
  const [carregandoArquivos, setCarregandoArquivos] = useState(false);

  // Histórico pesquisável — busca em TODAS as conversas de uma vez, num
  // painel próprio (não filtra a conversa aberta, é global).
  const [buscaHistoricoAberta, setBuscaHistoricoAberta] = useState(false);
  const [buscaHistoricoQuery, setBuscaHistoricoQuery] = useState("");
  const [buscaHistoricoResultados, setBuscaHistoricoResultados] = useState<Mensagem[]>([]);
  const [buscandoHistorico, setBuscandoHistorico] = useState(false);

  // Notificações configuráveis por conversa — carregado uma vez, todas de
  // uma vez (poucas linhas por pessoa), mapeado por chavePreferencia.
  const [preferencias, setPreferencias] = useState<PreferenciaNotificacaoCanal[]>([]);
  const [menuNotifAberto, setMenuNotifAberto] = useState(false);

  // Reações — que emoji picker está aberto (id da mensagem, ou null).
  const [pickerReacaoAberto, setPickerReacaoAberto] = useState<string | null>(null);

  // Achado M6 do check-up (Fase 2, 22/07/2026) — a bolha de mensagem expunha
  // até 3 botões simultâneos sempre visíveis no hover (reagir/responder em
  // thread/fixar), além de reações e "ver leitura" já persistentes. Reagir
  // continua direto (ação mais usada); responder/fixar entram neste menu
  // "..." (id da mensagem com o menu aberto, ou null — mesmo padrão de
  // `pickerReacaoAberto` acima).
  const [menuAcoesMensagemId, setMenuAcoesMensagemId] = useState<string | null>(null);

  // Indicador de leitura — carregado sob demanda por mensagem (só quando o
  // autor clica em "ver leitura" na própria última mensagem).
  const [leitoresPorMensagem, setLeitoresPorMensagem] = useState<Record<string, string[]>>({});
  const [carregandoLeitores, setCarregandoLeitores] = useState<string | null>(null);

  // Presença — status online/ausente de cada contato visível na tela
  // (lista + cabeçalho da conversa DIRETA aberta), atualizado por polling.
  const [presencas, setPresencas] = useState<Record<string, StatusPresenca>>({});

  // Menções (@) — autocomplete no compose principal. `inicio` é o índice do
  // "@" no texto, usado pra recortar/substituir só o trecho da menção ao
  // escolher alguém (sem precisar de ref pro <textarea>, que TextArea em
  // components/ui.tsx não repassa — tudo derivado de e.target no onChange).
  const [mencaoAtiva, setMencaoAtiva] = useState<{ query: string; inicio: number } | null>(null);
  // Membros de verdade do canal aberto (22/07/2026, achado ao revisar a
  // segmentação de chat: o autocomplete de @menção oferecia TODO MUNDO da
  // empresa, mesmo dentro de um canal restrito tipo Locação/Itaúna —
  // inofensivo pro lado de notificação, mas confuso, já que quem não é
  // membro nunca é notificado mesmo assim). Buscado sempre que o canal
  // aberto muda; fica vazio pra DIRETA (usa o próprio contato, ver
  // `mencaoOpcoes` abaixo) e enquanto nada está aberto.
  const [membrosCanalAtual, setMembrosCanalAtual] = useState<{ usuarioId: string; nome: string }[]>([]);

  // Canais liberados pro usuário logado (ver GET /mensagens/canais-
  // disponiveis) — já vem em árvore (Unidade > Setor + setores globais +
  // canal Empresa), pronta pra montar a aba "Canais" sem o frontend
  // reimplementar a regra de acesso. Buscado uma vez; não muda durante a
  // sessão (mudança de setor do próprio colaborador exigiria relogar).
  useEffect(() => {
    mensagensApi
      .canaisDisponiveis()
      .then((c) => {
        setCanais(c);
        // Unidade com algo relevante começa aberta — poucas unidades (3),
        // não há necessidade de esconder por padrão.
        setUnidadesAbertas(new Set(c.unidades.map((u) => u.id)));
      })
      .catch(() =>
        setCanais({ irrestrito: false, canalEmpresa: { id: CANAL_EMPRESA_ID, nome: "Avisos da Empresa" }, unidades: [], setoresGlobais: [] })
      );
  }, []);

  function carregarFavoritos() {
    favoritosApi
      .listar()
      .then(setFavoritos)
      .catch(() => {});
  }
  useEffect(carregarFavoritos, []);

  const favoritosSet = useMemo(() => new Set(favoritos.map((f) => chaveFavorito(f.tipo, f.alvoId))), [favoritos]);

  // Preferências de notificação por conversa (Fase 2, 21/07/2026) —
  // carregadas uma vez; recarregadas depois de cada alteração no menu do
  // sino (ver alterarPreferenciaAtual mais abaixo).
  function carregarPreferencias() {
    preferenciasNotificacaoCanalApi
      .listar()
      .then(setPreferencias)
      .catch(() => {});
  }
  useEffect(carregarPreferencias, []);
  const preferenciasMap = useMemo(
    () => new Map(preferencias.map((p) => [chavePreferencia(p.tipo, p.alvoId), p.modo])),
    [preferencias]
  );

  // Presença (Fase 2, 21/07/2026, pedido do Vini: "status online" e "status
  // ausente") — heartbeat só enquanto a aba está de fato em foco (evita
  // fingir presença de quem só deixou o sistema aberto minimizado); a cada
  // 25s, folgado o bastante em relação ao LIMITE_ONLINE_MS de 90s do
  // backend pra tolerar 1-2 falhas de rede sem a pessoa "piscar" ausente.
  useEffect(() => {
    function bater() {
      if (document.visibilityState === "visible") presencaApi.heartbeat().catch(() => {});
    }
    bater();
    const t = setInterval(bater, 25000);
    return () => clearInterval(t);
  }, []);

  async function alternarFavorito(a: Alvo) {
    const { tipo, alvoId } = alvoParaFavorito(a);
    const chave = chaveFavorito(tipo, alvoId);
    try {
      if (favoritosSet.has(chave)) {
        await favoritosApi.remover(tipo, alvoId);
      } else {
        await favoritosApi.adicionar(tipo, alvoId);
      }
      carregarFavoritos();
    } catch {
      // silencioso — favoritar é conveniência, não crítico o bastante pra
      // interromper a leitura/envio de mensagem com um erro bloqueante
    }
  }

  // Colegas com login ativo — não existe endpoint próprio de "usuários", a
  // lista de colaborador (que já vem no AppData) cobre isso: todo Usuario
  // tem um Colaborador vinculado, exceto a conta puramente administrativa
  // (ver GET /tecnicos, mesma exclusão aplicada aqui por consistência).
  // Busca (21/07/2026, item "pesquisa instantânea" do pedido do Vini) passa
  // a considerar também setor/unidade/cargo, não só o nome — ex: digitar
  // "Financeiro" encontra todo mundo do Financeiro, não só quem se chama
  // Financeiro.
  const contatos = useMemo(
    () =>
      data.colaboradores
        .filter((c) => c.usuario && c.usuario.ativo && c.usuario.id !== user?.id)
        .map((c) => ({
          usuarioId: c.usuario!.id,
          nome: c.nomeCompleto,
          setor: c.setor?.nome || "",
          unidade: c.unidade?.nome || "",
          cargo: c.cargo?.nome || "",
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    [data.colaboradores, user?.id]
  );

  // Presença (Fase 2, 21/07/2026) — consulta em lote do status de todo
  // contato/pessoa visível na tela agora (lista de conversas + resultado de
  // "nova conversa" + o alvo DIRETA aberto), evitando 1 requisição por
  // pessoa.
  useEffect(() => {
    const ids = new Set<string>();
    for (const c of conversas) if (c.tipo === "DIRETA") ids.add(c.contato.id);
    for (const c of contatos) ids.add(c.usuarioId);
    if (alvo?.tipo === "DIRETA") ids.add(alvo.usuarioId);
    if (ids.size === 0) return;
    let ativo = true;
    function consultar() {
      presencaApi
        .status(Array.from(ids))
        .then((s) => ativo && setPresencas(s))
        .catch(() => {});
    }
    consultar();
    const t = setInterval(consultar, 20000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversas, contatos, alvo?.tipo === "DIRETA" ? alvo.usuarioId : null]);

  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — abre a
  // conversa DIRETA com quem mandou a mensagem que originou o clique. Só
  // troca de conversa quando o id efetivamente muda (não a cada render),
  // então clicar duas vezes no mesmo pop-up ou reabrir a aba não força uma
  // recarga desnecessária de thread já visível.
  useEffect(() => {
    if (!abrirConversaComUsuarioId) return;
    const contato = contatos.find((c) => c.usuarioId === abrirConversaComUsuarioId);
    setAba("conversas");
    setAlvo({ tipo: "DIRETA", usuarioId: abrirConversaComUsuarioId, nome: contato?.nome || "Conversa" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirConversaComUsuarioId]);

  // Mesmo padrão do efeito acima, pra clique num pop-up de notificação de
  // canal — o nome vem da árvore de canais liberados (já buscada em
  // paralelo, ver useEffect logo acima desta); se o clique chegar antes dela
  // terminar de carregar, mostra um rótulo genérico até o próximo render.
  useEffect(() => {
    if (!abrirCanal) return;
    let tipoInterno: Exclude<TipoMensagem, "DIRETA">;
    let nome = "Canal";
    if (abrirCanal.tipo === "unidade") {
      tipoInterno = "CANAL_UNIDADE";
      nome = canais?.unidades.find((u) => u.id === abrirCanal.id)?.nome || nome;
    } else if (abrirCanal.tipo === "setor") {
      tipoInterno = "CANAL_SETOR";
      nome = canais?.setoresGlobais.find((s) => s.id === abrirCanal.id)?.nome || nome;
    } else if (abrirCanal.tipo === "setor-unidade") {
      tipoInterno = "CANAL_SETOR_UNIDADE";
      for (const u of canais?.unidades || []) {
        const s = u.setores.find((s) => s.chave === abrirCanal.id);
        if (s) {
          nome = `${s.nome} · ${u.nome}`;
          break;
        }
      }
    } else {
      tipoInterno = "CANAL_EMPRESA";
      nome = canais?.canalEmpresa.nome || "Avisos da Empresa";
    }
    // aba "conversas" (rótulo "Recentes" na tela) — mesmo destino da
    // notificação DIRETA acima, já que o canal também aparece ali agora.
    setAba("conversas");
    setAlvo({ tipo: tipoInterno, id: abrirCanal.id, nome });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirCanal, canais]);

  async function carregarConversas() {
    try {
      const lista = await mensagensApi.conversas();
      setConversas(lista);
      // Sucesso limpa um erro anterior — ex: rede caiu num poll, voltou no
      // próximo, a mensagem de erro não deveria continuar presa na tela.
      setErroConversas(null);
    } catch (e) {
      // Diferente do padrão de outras telas (ver ApiError em Chamados.tsx/
      // Pagamentos.tsx): aqui NÃO interrompe a UI com um erro bloqueante —
      // isto roda em polling/SSE em segundo plano o tempo todo, então um
      // erro de rede transitório não deve incomodar quem já está vendo a
      // lista carregada (ver uso de `erroConversas` no render, só exibido
      // quando a lista está vazia). Guarda a mensagem mesmo assim pra cobrir
      // o caso da CARGA INICIAL falhar — aí sim precisa ficar visível.
      setErroConversas(e instanceof ApiError ? e.message : "Não foi possível carregar suas conversas.");
    } finally {
      setCarregandoConversas(false);
    }
  }

  useEffect(() => {
    carregarConversas();
    const t = setInterval(carregarConversas, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // SSE como caminho rápido (achado M4, 22/07/2026) — dispara os MESMOS
  // `carregarConversas`/`carregarThread` que o polling acima já chama,
  // então nenhuma lógica de busca nova aqui, só um gatilho adicional mais
  // rápido. Sem risco de corrida com o polling: as duas fontes chamam a
  // mesma função idempotente (busca e substitui o estado atual), e
  // `carregarThread` já se protege sozinho contra resposta atrasada de um
  // alvo que não é mais o selecionado (ver `mesmoAlvo(alvoRef.current, a)`
  // dentro dela) — então um SSE e um poll cruzando no meio um do outro no
  // pior caso só refazem a mesma busca 2x, nunca deixam estado inconsistente.
  useEffect(
    () =>
      assinarMensagensAtualizadas(() => {
        carregarConversas();
        if (alvoRef.current) carregarThread(alvoRef.current);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function carregarThread(a: Alvo) {
    setCarregandoThread(true);
    try {
      const lista = a.tipo === "DIRETA" ? await mensagensApi.thread(a.usuarioId) : await mensagensApi.canal(tipoParaUrl(a.tipo), a.id);
      // Evita sobrescrever com resposta atrasada de um alvo que já não é
      // mais o selecionado (troca rápida entre conversas durante o polling).
      if (mesmoAlvo(alvoRef.current, a)) setMensagens(lista);
      if (a.tipo === "DIRETA") {
        await mensagensApi.marcarLida(a.usuarioId);
      } else {
        // "Recentes" unificado (09/07/2026) — mesmo gesto de marcar como
        // lida, agora pros 4 tipos de canal (ver LeituraCanal no backend).
        await mensagensApi.marcarCanalLida(tipoParaUrl(a.tipo), a.id);
      }
      carregarConversas();
    } catch {
      // idem
    } finally {
      if (mesmoAlvo(alvoRef.current, a)) setCarregandoThread(false);
    }
  }

  useEffect(() => {
    if (!alvo) return;
    setMensagens([]);
    carregarThread(alvo);
    const t = setInterval(() => carregarThread(alvo), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo && (alvo.tipo === "DIRETA" ? alvo.usuarioId : alvo.id)]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens]);

  // `tipo`/`id` no formato que as rotas unificadas de conversa (fixados,
  // arquivos compartilhados) esperam — ver tipoParaUrlConversa em
  // api/mensagens.ts.
  function alvoParaConversaUrl(a: Alvo): { tipo: ReturnType<typeof tipoParaUrlConversa>; id: string } {
    return a.tipo === "DIRETA"
      ? { tipo: tipoParaUrlConversa("DIRETA"), id: a.usuarioId }
      : { tipo: tipoParaUrlConversa(a.tipo), id: a.id };
  }

  function carregarFixadas(a: Alvo) {
    const { tipo, id } = alvoParaConversaUrl(a);
    fixadosApi
      .listar(tipo, id)
      .then((lista) => mesmoAlvo(alvoRef.current, a) && setFixadas(lista))
      .catch(() => {});
  }

  // Troca de conversa (Fase 2, 21/07/2026) — fecha qualquer painel/estado
  // que pertencia à conversa anterior (thread aberta, resposta em digitação,
  // arquivos, picker de reação, autocomplete de menção) e recarrega
  // fixadas da nova. Sem isso, por exemplo, "respondendo a" continuaria
  // apontando pra uma mensagem de outra conversa depois de trocar de aba.
  useEffect(() => {
    setRespondendoA(null);
    setThreadAberta(null);
    setThreadRespostas([]);
    setArquivosPainelAberto(false);
    setArquivosCompartilhados([]);
    setPickerReacaoAberto(null);
    setMenuAcoesMensagemId(null);
    setMencaoAtiva(null);
    setFixadas([]);
    setFixadasAbertas(false);
    setMembrosCanalAtual([]);
    if (!alvo) return;
    carregarFixadas(alvo);
    // Membros de verdade do canal aberto, pro autocomplete de @menção (ver
    // comentário do state `membrosCanalAtual` acima) — só faz sentido pra
    // canal (grupo); DIRETA usa o próprio contato direto, sem precisar de
    // rota nenhuma (ver `mencaoOpcoes`).
    if (alvo.tipo !== "DIRETA") {
      mensagensApi
        .membrosCanal(tipoParaUrl(alvo.tipo), alvo.id)
        .then((membros) => mesmoAlvo(alvoRef.current, alvo) && setMembrosCanalAtual(membros))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo?.tipo, alvo && (alvo.tipo === "DIRETA" ? alvo.usuarioId : alvo.id)]);

  function selecionarArquivo(f: File) {
    setErro(null);
    if (!ANEXO_MIME_PERMITIDOS.has(f.type)) {
      setErro("Tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou vídeo (MP4, WEBM, MOV).");
      return;
    }
    if (f.size > ANEXO_TAMANHO_MAXIMO) {
      setErro(`Arquivo excede o tamanho máximo permitido (${Math.floor(ANEXO_TAMANHO_MAXIMO / 1024 / 1024)}MB).`);
      return;
    }
    setArquivo(f);
  }

  async function enviar() {
    // Mensagem só de anexo (sem texto) é permitida — só bloqueia se não tem
    // nem um nem outro.
    if (!alvo || (!texto.trim() && !arquivo)) return;
    setEnviando(true);
    setErro(null);
    try {
      const conteudo = texto.trim();
      let body: Parameters<typeof mensagensApi.enviar>[0];
      if (alvo.tipo === "DIRETA") {
        body = { tipo: "DIRETA", destinatarioId: alvo.usuarioId, conteudo };
      } else if (alvo.tipo === "CANAL_UNIDADE") {
        body = { tipo: "CANAL_UNIDADE", unidadeId: alvo.id, conteudo };
      } else if (alvo.tipo === "CANAL_SETOR") {
        body = { tipo: "CANAL_SETOR", setorId: alvo.id, conteudo };
      } else if (alvo.tipo === "CANAL_SETOR_UNIDADE") {
        // alvo.id é a chave composta (chaveSetorUnidade) — a rota de envio
        // espera unidadeId e setorId separados no corpo, então desmonta
        // aqui (ver enviarSchema em mensagens.routes.ts).
        const [unidadeId, setorId] = alvo.id.split(":");
        body = { tipo: "CANAL_SETOR_UNIDADE", unidadeId, setorId, conteudo };
      } else {
        body = { tipo: "CANAL_EMPRESA", conteudo };
      }
      // Resposta em thread (Fase 2, 21/07/2026) — anexa respostaAId quando o
      // usuário clicou em "Responder" numa mensagem antes de escrever; o
      // resto do corpo já é a conversa normal (ver validação no backend).
      if (respondendoA) body = { ...body, respostaAId: respondendoA.id };
      if (arquivo) {
        await mensagensApi.enviarComAnexo(body, arquivo);
      } else {
        await mensagensApi.enviar(body);
      }
      setTexto("");
      setArquivo(null);
      setRespondendoA(null);
      setMencaoAtiva(null);
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
      await carregarThread(alvo);
      carregarConversas();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar a mensagem.");
    } finally {
      setEnviando(false);
    }
  }

  // Toggle de reação (Fase 2, 21/07/2026) — otimista o bastante: espera a
  // resposta do backend (já vem com o total agrupado) e substitui só a
  // mensagem afetada na lista, sem esperar o próximo polling.
  async function reagir(mensagemId: string, emoji: EmojiReacao) {
    setPickerReacaoAberto(null);
    try {
      const { reacoes } = await reacoesApi.reagir(mensagemId, emoji);
      setMensagens((prev) => prev.map((m) => (m.id === mensagemId ? { ...m, reacoes } : m)));
    } catch {
      // silencioso — mesmo racional de favoritar, reação não é crítica o
      // bastante pra interromper a leitura com um erro bloqueante
    }
  }

  // Fixar/desfixar (Fase 2, 21/07/2026) — recarrega a lista de fixadas
  // (poucas linhas, sem custo relevante) em vez de tentar atualizar em
  // memória, porque quem fixou pode não ser "eu" na próxima leitura.
  async function alternarFixada(m: Mensagem) {
    if (!alvo) return;
    try {
      if (m.fixada) await fixadosApi.desfixar(m.id);
      else await fixadosApi.fixar(m.id);
      setMensagens((prev) => prev.map((x) => (x.id === m.id ? { ...x, fixada: !m.fixada } : x)));
      carregarFixadas(alvo);
    } catch {
      // silencioso — mesmo racional de favoritar/reagir
    }
  }

  function abrirThread(m: Mensagem) {
    setThreadAberta(m);
    setThreadRespostas([]);
    setCarregandoThreadPainel(true);
    mensagensApi
      .respostas(m.id)
      .then(setThreadRespostas)
      .catch(() => {})
      .finally(() => setCarregandoThreadPainel(false));
  }

  async function enviarRespostaThread() {
    if (!alvo || !threadAberta || !textoThread.trim()) return;
    setEnviandoThread(true);
    try {
      const conteudo = textoThread.trim();
      let body: Parameters<typeof mensagensApi.enviar>[0];
      if (alvo.tipo === "DIRETA") body = { tipo: "DIRETA", destinatarioId: alvo.usuarioId, conteudo, respostaAId: threadAberta.id };
      else if (alvo.tipo === "CANAL_UNIDADE") body = { tipo: "CANAL_UNIDADE", unidadeId: alvo.id, conteudo, respostaAId: threadAberta.id };
      else if (alvo.tipo === "CANAL_SETOR") body = { tipo: "CANAL_SETOR", setorId: alvo.id, conteudo, respostaAId: threadAberta.id };
      else if (alvo.tipo === "CANAL_SETOR_UNIDADE") {
        const [unidadeId, setorId] = alvo.id.split(":");
        body = { tipo: "CANAL_SETOR_UNIDADE", unidadeId, setorId, conteudo, respostaAId: threadAberta.id };
      } else body = { tipo: "CANAL_EMPRESA", conteudo, respostaAId: threadAberta.id };

      const nova = await mensagensApi.enviar(body);
      setThreadRespostas((prev) => [...prev, nova]);
      setThreadAberta((prev) => (prev ? { ...prev, totalRespostas: (prev.totalRespostas ?? 0) + 1 } : prev));
      setMensagens((prev) => prev.map((x) => (x.id === threadAberta.id ? { ...x, totalRespostas: (x.totalRespostas ?? 0) + 1 } : x)));
      setTextoThread("");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar a resposta.");
    } finally {
      setEnviandoThread(false);
    }
  }

  function carregarLeitores(mensagemId: string) {
    setCarregandoLeitores(mensagemId);
    mensagensApi
      .leitores(mensagemId)
      .then(({ leitores }) => setLeitoresPorMensagem((prev) => ({ ...prev, [mensagemId]: leitores })))
      .catch(() => {})
      .finally(() => setCarregandoLeitores(null));
  }

  function abrirArquivosCompartilhados() {
    if (!alvo) return;
    setArquivosPainelAberto(true);
    setCarregandoArquivos(true);
    const { tipo, id } = alvoParaConversaUrl(alvo);
    arquivosCompartilhadosApi
      .listar(tipo, id)
      .then(setArquivosCompartilhados)
      .catch(() => {})
      .finally(() => setCarregandoArquivos(false));
  }

  // Debounce de 350ms — sem isso, cada tecla digitada disparava uma busca
  // no banco inteiro; o timer é cancelado/reiniciado a cada nova letra.
  function buscarHistorico(q: string) {
    setBuscaHistoricoQuery(q);
    if (buscaHistoricoTimer.current) clearTimeout(buscaHistoricoTimer.current);
    if (q.trim().length < 2) {
      setBuscaHistoricoResultados([]);
      setBuscandoHistorico(false);
      return;
    }
    setBuscandoHistorico(true);
    buscaHistoricoTimer.current = setTimeout(async () => {
      try {
        setBuscaHistoricoResultados(await mensagensApi.buscar(q.trim()));
      } catch {
        setBuscaHistoricoResultados([]);
      } finally {
        setBuscandoHistorico(false);
      }
    }, 350);
  }

  // Navega até a conversa de um resultado da busca de histórico — usa os
  // próprios campos da Mensagem pra reconstruir o Alvo (mesma convenção de
  // sempre: destinatarioId/unidadeId/setorId conforme o tipo).
  function abrirResultadoBusca(m: Mensagem) {
    setBuscaHistoricoAberta(false);
    setBuscaHistoricoQuery("");
    setBuscaHistoricoResultados([]);
    if (m.tipo === "DIRETA") {
      const outroId = m.remetenteId === user?.id ? m.destinatarioId! : m.remetenteId;
      const contato = contatos.find((c) => c.usuarioId === outroId);
      setAba("conversas");
      setAlvo({ tipo: "DIRETA", usuarioId: outroId, nome: contato?.nome || nomeExibicao(m.remetente) });
    } else if (m.tipo === "CANAL_SETOR_UNIDADE") {
      const alvoId = chaveSetorUnidade(m.unidadeId as string, m.setorId as string);
      let nome = "Canal";
      for (const u of canais?.unidades || []) {
        const s = u.setores.find((s) => s.chave === alvoId);
        if (s) nome = `${s.nome} · ${u.nome}`;
      }
      setAba("conversas");
      setAlvo({ tipo: "CANAL_SETOR_UNIDADE", id: alvoId, nome });
    } else if (m.tipo === "CANAL_UNIDADE") {
      const nome = canais?.unidades.find((u) => u.id === m.unidadeId)?.nome || "Minha Equipe";
      setAba("conversas");
      setAlvo({ tipo: "CANAL_UNIDADE", id: m.unidadeId as string, nome });
    } else if (m.tipo === "CANAL_SETOR") {
      const nome = canais?.setoresGlobais.find((s) => s.id === m.setorId)?.nome || "Setor";
      setAba("conversas");
      setAlvo({ tipo: "CANAL_SETOR", id: m.setorId as string, nome });
    } else {
      setAba("conversas");
      setAlvo({ tipo: "CANAL_EMPRESA", id: CANAL_EMPRESA_ID, nome: canais?.canalEmpresa.nome || "Avisos da Empresa" });
    }
  }

  // Notificações configuráveis por conversa (Fase 2, 21/07/2026) — modo
  // atual do alvo aberto (TODAS se não houver linha, mesmo default do
  // backend) e a troca via menu do sino.
  const preferenciaAtual: ModoNotificacaoCanal = alvo
    ? preferenciasMap.get(chavePreferencia(alvo.tipo, alvo.tipo === "DIRETA" ? alvo.usuarioId : alvo.id)) || "TODAS"
    : "TODAS";

  async function alterarPreferenciaAtual(modo: ModoNotificacaoCanal) {
    if (!alvo) return;
    setMenuNotifAberto(false);
    const alvoId = alvo.tipo === "DIRETA" ? alvo.usuarioId : alvo.id;
    try {
      await preferenciasNotificacaoCanalApi.atualizar(alvo.tipo, alvoId, modo);
      carregarPreferencias();
    } catch {
      // silencioso — mesmo racional das outras preferências de conveniência
    }
  }

  // Menções (@) — chamado no onChange do compose principal: detecta se o
  // cursor está dentro de um "@token" em digitação (sem espaço entre o "@" e
  // o cursor) pra abrir/fechar/filtrar o autocomplete.
  function aoDigitar(valor: string, posicaoCursor: number) {
    setTexto(valor);
    const antesDoCursor = valor.slice(0, posicaoCursor);
    const arroba = antesDoCursor.lastIndexOf("@");
    if (arroba === -1) {
      setMencaoAtiva(null);
      return;
    }
    const trecho = antesDoCursor.slice(arroba + 1);
    if (/[\s@]/.test(trecho)) {
      setMencaoAtiva(null);
      return;
    }
    setMencaoAtiva({ query: trecho, inicio: arroba });
  }

  function escolherMencao(contato: { usuarioId: string; nome: string }) {
    if (!mencaoAtiva) return;
    const cursorAtual = mencaoAtiva.inicio + 1 + mencaoAtiva.query.length;
    const token = `@[${contato.nome}](${contato.usuarioId})`;
    setTexto((prev) => prev.slice(0, mencaoAtiva.inicio) + token + " " + prev.slice(cursorAtual));
    setMencaoAtiva(null);
  }

  // Fonte das opções de @menção (22/07/2026) — restrita a quem de fato
  // pertence à conversa aberta, pra não oferecer @menção de alguém que
  // nunca vai ser notificado (ver comentário do state `membrosCanalAtual`
  // acima). Numa DIRETA, a única opção sensata é a própria outra pessoa.
  const opcoesDeMencao = useMemo(() => {
    if (!alvo) return [];
    if (alvo.tipo === "DIRETA") return [{ usuarioId: alvo.usuarioId, nome: alvo.nome }];
    return membrosCanalAtual;
  }, [alvo, membrosCanalAtual]);

  const mencaoOpcoes = useMemo(() => {
    if (!mencaoAtiva) return [];
    const q = mencaoAtiva.query.toLowerCase();
    return opcoesDeMencao.filter((c) => c.nome.toLowerCase().includes(q)).slice(0, 6);
  }, [mencaoAtiva, opcoesDeMencao]);

  // Indicador de leitura por mensagem (Fase 2, 21/07/2026) — mostrado só na
  // MINHA última mensagem enviada nesta conversa, não necessariamente a
  // última mensagem da conversa (que pode ser uma resposta da outra
  // pessoa) — senão o indicador quase nunca apareceria numa conversa ativa.
  const ultimoIndiceMensagemMinha = useMemo(() => {
    for (let i = mensagens.length - 1; i >= 0; i--) {
      if (mensagens[i].remetenteId === user?.id) return i;
    }
    return -1;
  }, [mensagens, user?.id]);

  // Corrigido (22/07/2026, achado do Vini: "não lista todos os
  // colaboradores, precisa ter todos os colaboradores ativos") — até aqui
  // filtrava fora quem já tinha uma conversa em "Recentes" (`idsComConversa`),
  // então o modal "Nova conversa" nunca mostrava a lista completa de gente
  // ativa, só quem você ainda não tinha falado. Clicar em alguém que já tem
  // conversa aberta simplesmente abre ela de novo (mesmo efeito de clicar no
  // nome dela em "Recentes"), então não há razão pra escondê-la aqui.
  const buscaLower = buscaContato.toLowerCase();
  const contatosFiltrados = contatos.filter(
    (c) =>
      c.nome.toLowerCase().includes(buscaLower) ||
      c.setor.toLowerCase().includes(buscaLower) ||
      c.unidade.toLowerCase().includes(buscaLower) ||
      c.cargo.toLowerCase().includes(buscaLower)
  );

  function toggleUnidadeAberta(id: string) {
    setUnidadesAbertas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  // Nome exibido de um favorito — resolvido a partir da árvore de canais já
  // carregada (ou dos contatos, pra DIRETA). Favorito de canal ao qual o
  // usuário perdeu acesso (setor mudou, exceção revogada) cai no fallback
  // "Conversa" — a linha continua clicável, o backend é quem decide 403 se
  // for o caso.
  function nomeFavorito(f: Favorito): string {
    if (f.tipo === "DIRETA") return contatos.find((c) => c.usuarioId === f.alvoId)?.nome || "Conversa";
    if (f.tipo === "CANAL_EMPRESA") return canais?.canalEmpresa.nome || "Avisos da Empresa";
    if (f.tipo === "CANAL_SETOR") return canais?.setoresGlobais.find((s) => s.id === f.alvoId)?.nome || "Setor";
    if (f.tipo === "CANAL_UNIDADE") return canais?.unidades.find((u) => u.id === f.alvoId)?.nome || "Unidade";
    // CANAL_SETOR_UNIDADE
    for (const u of canais?.unidades || []) {
      const s = u.setores.find((s) => s.chave === f.alvoId);
      if (s) return `${s.nome} · ${u.nome}`;
    }
    return "Canal";
  }

  function abrirFavorito(f: Favorito) {
    const nome = nomeFavorito(f);
    if (f.tipo === "DIRETA") setAlvo({ tipo: "DIRETA", usuarioId: f.alvoId, nome });
    else setAlvo({ tipo: f.tipo, id: f.alvoId, nome });
  }

  const favoritoAtual = useMemo(() => {
    if (!alvo) return false;
    const { tipo, alvoId } = alvoParaFavorito(alvo);
    return favoritosSet.has(chaveFavorito(tipo, alvoId));
  }, [alvo, favoritosSet]);

  // Achado de auditoria (08/07/2026, Etapa 7 — Responsividade): o layout de
  // 2 colunas (lista + conversa) era `flex` fixo, sem nenhuma adaptação pra
  // mobile — a coluna da lista (w-72 = 288px) sozinha já não cabe numa tela
  // de 375px, então a coluna da conversa ficava espremida em ~70px, com todo
  // o texto cortado. Abaixo de `sm`, mostra só uma coluna por vez (lista OU
  // conversa, alternando conforme `alvo`), com um botão "voltar" pra retornar
  // à lista — o mesmo padrão de navegação mobile de qualquer app de chat.
  // A partir de `sm`, volta a ser lista + conversa lado a lado como sempre foi.
  return (
    <div className="flex flex-col sm:flex-row gap-4" style={{ height: "calc(100vh - 140px)" }}>
      <div className={`${alvo ? "hidden sm:flex" : "flex"} w-full sm:w-72 flex-shrink-0 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] flex-col overflow-hidden`}>
        <div className="flex items-center border-b border-gray-100">
          <button
            onClick={() => setAba("conversas")}
            className={`flex-1 text-xs font-semibold py-2.5 transition-colors ${aba === "conversas" ? "text-brand-600 border-b-2 border-brand-600" : "text-gray-400 dark:text-slate-500"}`}
          >
            Recentes
          </button>
          <button
            onClick={() => setAba("canais")}
            className={`flex-1 text-xs font-semibold py-2.5 transition-colors ${aba === "canais" ? "text-brand-600 border-b-2 border-brand-600" : "text-gray-400 dark:text-slate-500"}`}
          >
            Canais
          </button>
          <button
            onClick={() => setAba("favoritos")}
            className={`flex-1 text-xs font-semibold py-2.5 transition-colors ${aba === "favoritos" ? "text-brand-600 border-b-2 border-brand-600" : "text-gray-400 dark:text-slate-500"}`}
          >
            Favoritos
          </button>
          {/* Achado M8 do check-up (22/07/2026) — as 3 abas acima (texto,
              flex-1) e os botões abaixo (só ícone, flex-shrink-0) tinham
              nenhuma pista visual de que são grupos DIFERENTES (abas de
              navegação vs. ações rápidas) — divisória simples entre os dois
              estilos, mesmo padrão de separador já usado no cabeçalho de
              grupo da barra lateral principal em App.tsx. */}
          <div className="w-px h-4 bg-gray-200 dark:bg-slate-700 flex-shrink-0" aria-hidden="true" />
          {/* Histórico pesquisável (Fase 2, 21/07/2026, pedido do Vini) —
              busca em TODAS as conversas de uma vez, num painel próprio
              (diferente do "Nova conversa" abaixo, que só filtra contatos). */}
          <button
            onClick={() => setBuscaHistoricoAberta(true)}
            className="px-2.5 py-2.5 text-gray-400 dark:text-slate-500 hover:text-brand-600 flex-shrink-0"
            title="Buscar no histórico de mensagens"
            aria-label="Buscar no histórico de mensagens"
          >
            <Search size={15} />
          </button>
          {/* "Visualizar como" (22/07/2026) — só Administrador. Ver
              comentário completo no state `visualizarComoAberto` acima. */}
          {user?.papel === "ADMINISTRADOR" && (
            <button
              onClick={() => setVisualizarComoAberto(true)}
              className="px-2.5 py-2.5 text-gray-400 dark:text-slate-500 hover:text-brand-600 flex-shrink-0"
              title="Visualizar canais como outro usuário"
              aria-label="Visualizar canais como outro usuário"
            >
              <Eye size={15} />
            </button>
          )}
          {/* Achado de auditoria C7 (22/07/2026) — ver comentário completo em
              `onIrParaConfiguracoes` na interface Props acima. */}
          {user?.papel === "ADMINISTRADOR" && onIrParaConfiguracoes && (
            <button
              onClick={onIrParaConfiguracoes}
              className="px-2.5 py-2.5 text-gray-400 dark:text-slate-500 hover:text-brand-600 flex-shrink-0"
              title="Gerenciar acesso extra a canais (em Configurações)"
              aria-label="Gerenciar acesso extra a canais (em Configurações)"
            >
              <Settings size={15} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {aba === "conversas" ? (
            <>
              {carregandoConversas ? (
                <div className="p-4 flex justify-center animate-[fadeIn_var(--motion-fast)_ease-out]"><Spinner size={16} /></div>
              ) : erroConversas && conversas.length === 0 ? (
                // Achado M3 do check-up (22/07/2026) — só aparece quando a
                // lista está de fato vazia POR CAUSA do erro (nunca sobrepõe
                // uma lista já carregada com sucesso antes); distinto do
                // "sem conversas ainda" logo abaixo, com botão de retry.
                <div className="px-3 py-6 text-center space-y-2">
                  <p className="text-xs text-gray-500 dark:text-slate-400">{erroConversas}</p>
                  <Button variant="ghost" onClick={carregarConversas}>Tentar novamente</Button>
                </div>
              ) : conversas.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500 px-3 py-4 text-center">
                  Nenhuma conversa ou canal com atividade ainda — comece uma abaixo ou em "Canais".
                </p>
              ) : (
                // "Recentes" unificado (09/07/2026, pedido do Vini) — mistura
                // conversa DIRETA e qualquer canal com atividade na mesma
                // lista, já ordenada por data da última mensagem (ver GET
                // /mensagens/conversas no backend); `c.tipo` decide o que
                // exibir e pra onde o clique navega.
                conversas.map((c) => {
                  const selecionado =
                    c.tipo === "DIRETA"
                      ? alvo?.tipo === "DIRETA" && alvo.usuarioId === c.contato.id
                      : alvo?.tipo === c.tipo && alvo.id === c.id;
                  const nome = c.tipo === "DIRETA" ? nomeExibicao(c.contato) : c.nome;
                  return (
                    <button
                      key={c.tipo === "DIRETA" ? c.contato.id : `${c.tipo}:${c.id}`}
                      onClick={() =>
                        setAlvo(c.tipo === "DIRETA" ? { tipo: "DIRETA", usuarioId: c.contato.id, nome } : { tipo: c.tipo, id: c.id, nome: c.nome })
                      }
                      className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors ${
                        selecionado ? "bg-brand-50 dark:bg-brand-500/15" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                          {c.tipo === "DIRETA" && <PresencaDot status={presencas[c.contato.id]} />}
                          {prefixoNome(c.tipo, nome)}
                        </span>
                        {c.naoLidas > 0 && (
                          <span className="bg-brand-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 flex-shrink-0">
                            {c.naoLidas}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 dark:text-slate-500 truncate mt-0.5">{textoSemMencoes(c.ultimaMensagem.conteudo)}</p>
                    </button>
                  );
                })
              )}
              <div className="p-2 border-t border-gray-100 mt-1">
                <button
                  onClick={() => setNovaConversaAberta(true)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10 rounded-[var(--radius-control)] py-2 transition-colors"
                >
                  <Plus size={14} /> Nova conversa
                </button>
              </div>
            </>
          ) : aba === "favoritos" ? (
            favoritos.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 px-3 py-4 text-center flex flex-col items-center gap-1.5">
                <Star size={18} className="opacity-40" />
                Nenhum favorito ainda — clique na estrela de uma conversa ou canal pra fixar aqui.
              </p>
            ) : (
              <div className="p-2 space-y-0.5">
                {favoritos.map((f) => {
                  const nome = nomeFavorito(f);
                  const selecionado =
                    (f.tipo === "DIRETA" && alvo?.tipo === "DIRETA" && alvo.usuarioId === f.alvoId) ||
                    (f.tipo !== "DIRETA" && alvo?.tipo === f.tipo && alvo.id === f.alvoId);
                  return (
                    <button
                      key={chaveFavorito(f.tipo, f.alvoId)}
                      onClick={() => abrirFavorito(f)}
                      className={`w-full text-left px-2 py-1.5 text-sm rounded-[var(--radius-control)] transition-colors flex items-center gap-1.5 ${
                        selecionado ? "bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400" : "text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      <Star size={12} className="flex-shrink-0 text-amber-400" style={{ fill: "currentColor" }} />
                      <span className="truncate">{prefixoNome(f.tipo, nome)}</span>
                    </button>
                  );
                })}
              </div>
            )
          ) : !canais ? (
            <div className="p-4 flex justify-center animate-[fadeIn_var(--motion-fast)_ease-out]"><Spinner size={16} /></div>
          ) : (
            <div className="p-2 space-y-3">
              <button
                onClick={() => setAlvo({ tipo: "CANAL_EMPRESA", id: canais.canalEmpresa.id, nome: canais.canalEmpresa.nome })}
                className={`w-full text-left px-2 py-1.5 text-sm rounded-[var(--radius-control)] transition-colors flex items-center gap-1.5 font-medium ${
                  alvo?.tipo === "CANAL_EMPRESA" ? "bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400" : "text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                }`}
              >
                <Megaphone size={14} className="flex-shrink-0" /> {canais.canalEmpresa.nome}
              </button>

              {canais.setoresGlobais.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500 px-2 mb-1">Setores</p>
                  {canais.setoresGlobais.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setAlvo({ tipo: "CANAL_SETOR", id: s.id, nome: s.nome })}
                      className={`w-full text-left px-2 py-1.5 text-sm rounded-[var(--radius-control)] transition-colors ${
                        alvo?.tipo === "CANAL_SETOR" && alvo.id === s.id ? "bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400" : "text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      # {s.nome}
                    </button>
                  ))}
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500 px-2 mb-1">Unidades</p>
                {canais.unidades.map((u) => {
                  const aberta = unidadesAbertas.has(u.id);
                  return (
                    <div key={u.id} className="mb-1">
                      <button
                        onClick={() => toggleUnidadeAberta(u.id)}
                        className="w-full text-left px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 rounded-[var(--radius-control)] hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-1"
                      >
                        {aberta ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <Building2 size={13} className="flex-shrink-0" /> {u.nome}
                      </button>
                      {aberta && (
                        <div className="pl-4">
                          {u.acessoEquipe && (
                            <button
                              onClick={() => setAlvo({ tipo: "CANAL_UNIDADE", id: u.id, nome: u.nome })}
                              className={`w-full text-left px-2 py-1.5 text-sm rounded-[var(--radius-control)] transition-colors ${
                                alvo?.tipo === "CANAL_UNIDADE" && alvo.id === u.id ? "bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400" : "text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                              }`}
                            >
                              # Minha Equipe
                            </button>
                          )}
                          {u.setores.map((s) => {
                            const alvoId = s.chave;
                            return (
                              <button
                                key={s.id}
                                onClick={() => setAlvo({ tipo: "CANAL_SETOR_UNIDADE", id: alvoId, nome: `${s.nome} · ${u.nome}` })}
                                className={`w-full text-left px-2 py-1.5 text-sm rounded-[var(--radius-control)] transition-colors ${
                                  alvo?.tipo === "CANAL_SETOR_UNIDADE" && alvo.id === alvoId
                                    ? "bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400"
                                    : "text-slate-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                                }`}
                              >
                                # {s.nome}
                              </button>
                            );
                          })}
                          {!u.acessoEquipe && u.setores.length === 0 && (
                            <p className="text-xs text-gray-400 dark:text-slate-500 px-2 py-1">Nenhum canal liberado.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {canais.unidades.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400 px-2 py-1">Nenhum canal de unidade liberado.</p>}
              </div>
              {!canais.irrestrito && (
                <p className="text-[10px] text-gray-400 dark:text-slate-500 px-2 flex items-center gap-1">
                  <Lock size={11} /> Você só participa dos canais do seu setor/unidade (e exceções liberadas pelo administrador).
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={`${alvo ? "flex" : "hidden sm:flex"} flex-1 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] flex-col overflow-hidden min-w-0`}>
        {!alvo ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={MessageCircle} text="Escolha uma conversa ou canal para começar." />
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 flex items-center gap-2">
              <button
                onClick={() => setAlvo(null)}
                className="sm:hidden text-gray-400 dark:text-slate-500 hover:text-slate-700 p-1 -ml-1"
                aria-label="Voltar para a lista"
                title="Voltar"
              >
                <ArrowLeft size={18} />
              </button>
              <h4 className="text-sm font-semibold text-slate-800 flex-1 truncate flex items-center gap-1.5">
                {alvo.tipo === "DIRETA" && <PresencaDot status={presencas[alvo.usuarioId]} />}
                {/* Achado M5 do check-up (22/07/2026) — este cabeçalho usava
                    "# nome" cru pra QUALQUER canal, inclusive CANAL_EMPRESA
                    ("Avisos da Empresa"), que deveria levar 📣 igual ao
                    resto da tela (ver `prefixoNome`, já usado na lista de
                    conversas/favoritos acima). */}
                {prefixoNome(alvo.tipo, alvo.nome)}
              </h4>

              {/* Arquivos compartilhados (Fase 2, 21/07/2026, pedido do
                  Vini) — abre o painel sob demanda, sem custo enquanto o
                  usuário não clica.
                  Achado M2 do check-up (22/07/2026): este botão usava o
                  MESMO ícone de clipe de papel do "anexar arquivo" no
                  compose, lá embaixo — 2 clipes na mesma tela fazendo
                  coisas diferentes. Pasta = "coleção de arquivos já
                  trocados", sem ambiguidade com "anexar nesta mensagem". */}
              <button
                onClick={abrirArquivosCompartilhados}
                className="text-gray-300 dark:text-slate-600 hover:text-brand-600 flex-shrink-0 p-1"
                title="Arquivos compartilhados"
                aria-label="Arquivos compartilhados"
              >
                <Folder size={16} />
              </button>

              {/* Notificações configuráveis por conversa (Fase 2, 21/07/2026,
                  pedido do Vini: "notificações configuráveis") — Todas /
                  Menções / Silenciado, independente da preferência global
                  por categoria (ver Central de Notificações). */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setMenuNotifAberto((v) => !v)}
                  className={`p-1 ${preferenciaAtual === "SILENCIADO" ? "text-gray-400 dark:text-slate-500" : "text-gray-300 dark:text-slate-600 hover:text-brand-600"}`}
                  title="Preferência de notificação desta conversa"
                  aria-label="Preferência de notificação desta conversa"
                >
                  {preferenciaAtual === "SILENCIADO" ? <BellOff size={16} /> : <Bell size={16} />}
                </button>
                {menuNotifAberto && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuNotifAberto(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] shadow-[var(--elevation-2)] py-1 w-44">
                      {(
                        [
                          ["TODAS", "Todas as mensagens"],
                          ["MENCOES", "Só menções (@)"],
                          ["SILENCIADO", "Silenciado"],
                        ] as [ModoNotificacaoCanal, string][]
                      ).map(([modo, rotulo]) => (
                        <button
                          key={modo}
                          onClick={() => alterarPreferenciaAtual(modo)}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${
                            preferenciaAtual === modo ? "text-brand-600 font-semibold" : "text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {rotulo}
                        </button>
                      ))}
                      {/* Achado M7 do check-up (22/07/2026) — existem 2
                          lugares de preferência de notificação: este (por
                          conversa/canal) e o painel geral por categoria, no
                          sino (Central de Notificações → Preferências). Nota
                          curta pra quem só olha um dos dois não ficar sem
                          saber que o outro existe. */}
                      <p className="px-3 pt-1.5 pb-1 text-[10px] text-gray-400 dark:text-slate-500 border-t border-gray-100 dark:border-slate-700 mt-1">
                        Isto só afeta esta conversa. Preferências gerais (som, categorias) ficam na Central de Notificações, no sino.
                      </p>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => alternarFavorito(alvo)}
                className="text-gray-300 dark:text-slate-600 hover:text-amber-400 flex-shrink-0 p-1"
                title={favoritoAtual ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                aria-label={favoritoAtual ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              >
                <Star size={16} style={favoritoAtual ? { fill: "currentColor", color: "#fbbf24" } : undefined} />
              </button>
            </div>

            {/* Mensagens fixadas (Fase 2, 21/07/2026, pedido do Vini) — barra
                colapsável, só aparece quando existe pelo menos 1 fixada
                nesta conversa. */}
            {fixadas.length > 0 && (
              <div className="border-b border-amber-100 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-500/10 flex-shrink-0">
                <button
                  onClick={() => setFixadasAbertas((v) => !v)}
                  className="w-full flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400"
                >
                  <Pin size={12} /> {fixadas.length} mensage{fixadas.length > 1 ? "ns fixadas" : "m fixada"}
                  {fixadasAbertas ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {fixadasAbertas && (
                  <div className="px-4 pb-2 space-y-1.5 max-h-32 overflow-y-auto">
                    {fixadas.map((f) => (
                      <div key={f.id} className="flex items-start justify-between gap-2 text-xs bg-white/70 dark:bg-slate-800/70 rounded-[var(--radius-control)] px-2 py-1.5">
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-600 dark:text-slate-300">{nomeExibicao(f.remetente)}: </span>
                          <span className="text-slate-500 dark:text-slate-400 truncate">{f.conteudo || "(anexo)"}</span>
                        </div>
                        <button
                          onClick={() => alternarFixada(f)}
                          className="text-gray-400 dark:text-slate-500 hover:text-brand-600 flex-shrink-0"
                          title="Desfixar"
                          aria-label="Desfixar"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {carregandoThread && mensagens.length === 0 ? (
                <LoadingState />
              ) : mensagens.length === 0 ? (
                <EmptyState icon={MessageCircle} text="Nenhuma mensagem ainda — mande a primeira." />
              ) : (
                mensagens.map((m, i) => {
                  const minha = m.remetenteId === user?.id;
                  const ultimaMinha = minha && i === ultimoIndiceMensagemMinha;
                  const reacoesAgrupadas = m.reacoes || [];
                  return (
                    <div key={m.id} className={`group flex ${minha ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[70%] rounded-xl px-3 py-2 text-sm relative ${minha ? "bg-slate-900 text-white" : "bg-gray-100 text-slate-800"}`}>
                        {!minha && alvo.tipo !== "DIRETA" && (
                          <p className="text-[10px] font-semibold opacity-60 mb-0.5">{nomeExibicao(m.remetente)}</p>
                        )}
                        {m.fixada && (
                          <p className={`text-[10px] flex items-center gap-1 mb-0.5 ${minha ? "text-amber-300" : "text-amber-600"}`}>
                            <Pin size={10} /> Fixada
                          </p>
                        )}
                        {m.anexoUrl && <AnexoMensagem mensagem={m} />}
                        {m.conteudo && (
                          <p className="whitespace-pre-wrap break-words">{renderConteudoComMencoes(m.conteudo, user?.id)}</p>
                        )}

                        {/* Reações (Fase 2, 21/07/2026) — badges agrupadas
                            por emoji; clicar em uma já existente também
                            faz toggle (sem precisar reabrir o picker). */}
                        {reacoesAgrupadas.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {reacoesAgrupadas.map((r) => {
                              const euReagi = user?.id ? r.usuarioIds.includes(user.id) : false;
                              return (
                                <button
                                  key={r.emoji}
                                  onClick={() => reagir(m.id, r.emoji as EmojiReacao)}
                                  className={`text-[11px] rounded-full px-1.5 py-0.5 border flex items-center gap-1 ${
                                    euReagi
                                      ? "bg-brand-100 dark:bg-brand-500/20 border-brand-300 dark:border-brand-700"
                                      : `border-transparent ${minha ? "bg-white/10" : "bg-white"}`
                                  }`}
                                  title={`${r.usuarioIds.length} reação(ões)`}
                                >
                                  {r.emoji} {r.usuarioIds.length}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Resposta em thread (Fase 2, 21/07/2026) — link "N
                            respostas" só aparece se já existe pelo menos 1. */}
                        {(m.totalRespostas ?? 0) > 0 && (
                          <button
                            onClick={() => abrirThread(m)}
                            className={`flex items-center gap-1 text-[11px] mt-1.5 font-semibold ${minha ? "text-white/70 hover:text-white" : "text-brand-600 hover:text-brand-700"}`}
                          >
                            <CornerUpLeft size={11} /> {m.totalRespostas} resposta{m.totalRespostas! > 1 ? "s" : ""}
                          </button>
                        )}

                        <div className="flex items-center justify-between gap-2 mt-1">
                          <p className={`text-[10px] ${minha ? "text-white/50" : "text-gray-400 dark:text-slate-500"}`}>{fmtHora(m.criadoEm)}</p>
                          {/* Indicador de leitura por mensagem (Fase 2,
                              21/07/2026, pedido do Vini) — só faz sentido na
                              última mensagem que EU mandei; carregado sob
                              demanda ao clicar (evita 1 chamada por
                              mensagem renderizada). */}
                          {ultimaMinha &&
                            (leitoresPorMensagem[m.id] !== undefined ? (
                              <span className="text-[10px] text-white/60 flex items-center gap-0.5">
                                <CheckCheck size={11} className={leitoresPorMensagem[m.id].length > 0 ? "text-emerald-300" : ""} />
                                {leitoresPorMensagem[m.id].length > 0 ? "Lida" : "Enviada"}
                              </span>
                            ) : (
                              <button
                                onClick={() => carregarLeitores(m.id)}
                                disabled={carregandoLeitores === m.id}
                                className="text-[10px] text-white/50 hover:text-white/80 flex items-center gap-0.5"
                              >
                                <CheckCheck size={11} /> {carregandoLeitores === m.id ? "..." : "Ver leitura"}
                              </button>
                            ))}
                        </div>

                        {/* Ações ao passar o mouse — só aparecem em hover pra
                            não poluir a bolha. Achado M6 do check-up
                            (22/07/2026): eram 3 botões sempre visíveis juntos
                            (reagir/responder/fixar); agora só "Reagir" fica
                            direto (ação mais usada), o resto entra no menu
                            "...". */}
                        <div
                          className={`hidden group-hover:flex items-center gap-1 absolute -top-3 ${minha ? "right-1" : "left-1"} bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full shadow-[var(--elevation-1)] px-1 py-0.5`}
                        >
                          <button
                            onClick={() => setPickerReacaoAberto((v) => (v === m.id ? null : m.id))}
                            className="text-gray-400 dark:text-slate-500 hover:text-brand-600 p-0.5"
                            title="Reagir"
                            aria-label="Reagir"
                          >
                            <Smile size={13} />
                          </button>
                          <button
                            onClick={() => setMenuAcoesMensagemId((v) => (v === m.id ? null : m.id))}
                            className="text-gray-400 dark:text-slate-500 hover:text-brand-600 p-0.5"
                            title="Mais ações"
                            aria-label="Mais ações"
                          >
                            <MoreHorizontal size={13} />
                          </button>
                        </div>

                        {menuAcoesMensagemId === m.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuAcoesMensagemId(null)} />
                            <div
                              className={`absolute z-20 -top-20 ${minha ? "right-0" : "left-0"} bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] shadow-[var(--elevation-2)] py-1 w-40`}
                            >
                              <button
                                onClick={() => {
                                  setRespondendoA(m);
                                  setMenuAcoesMensagemId(null);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-1.5"
                              >
                                <CornerUpLeft size={13} /> Responder em thread
                              </button>
                              <button
                                onClick={() => {
                                  alternarFixada(m);
                                  setMenuAcoesMensagemId(null);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-1.5"
                              >
                                <Pin size={13} className={m.fixada ? "text-amber-500" : ""} /> {m.fixada ? "Desfixar" : "Fixar"}
                              </button>
                            </div>
                          </>
                        )}

                        {pickerReacaoAberto === m.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setPickerReacaoAberto(null)} />
                            <div
                              className={`absolute z-20 -top-11 ${minha ? "right-0" : "left-0"} bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full shadow-[var(--elevation-2)] px-1.5 py-1 flex gap-0.5`}
                            >
                              {EMOJIS_REACAO_PERMITIDOS.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => reagir(m.id, emoji)}
                                  className="text-base hover:scale-125 transition-transform px-0.5"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {erro && <p className="mx-4 mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2 flex-shrink-0">{erro}</p>}
            {arquivo && (
              <div className="mx-3 mb-2 flex items-center justify-between gap-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] px-3 py-2 flex-shrink-0">
                <span className="text-xs text-slate-700 dark:text-slate-300 truncate">
                  {arquivo.name} <span className="text-gray-400 dark:text-slate-500">· {fmtTamanho(arquivo.size)}</span>
                </span>
                <button
                  onClick={() => {
                    setArquivo(null);
                    if (inputArquivoRef.current) inputArquivoRef.current.value = "";
                  }}
                  className="text-gray-400 dark:text-slate-500 hover:text-brand-600 flex-shrink-0"
                  aria-label="Remover anexo"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {/* Resposta em thread (Fase 2, 21/07/2026) — preview de "quem/o
                quê" acima do compose, com "X" pra cancelar e voltar a
                mandar uma mensagem normal na conversa. */}
            {respondendoA && (
              <div className="mx-3 mb-2 flex items-center justify-between gap-2 bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] px-3 py-2 flex-shrink-0">
                <div className="min-w-0 text-xs">
                  <span className="font-semibold text-brand-700 dark:text-brand-400">Respondendo a {nomeExibicao(respondendoA.remetente)}: </span>
                  <span className="text-slate-500 dark:text-slate-400 truncate">{respondendoA.conteudo || "(anexo)"}</span>
                </div>
                <button
                  onClick={() => setRespondendoA(null)}
                  className="text-gray-400 dark:text-slate-500 hover:text-brand-600 flex-shrink-0"
                  aria-label="Cancelar resposta"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="p-3 border-t border-gray-100 flex gap-2 flex-shrink-0 relative">
              <input
                ref={inputArquivoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) selecionarArquivo(f);
                }}
              />
              <Button
                variant="ghost"
                onClick={() => inputArquivoRef.current?.click()}
                disabled={enviando}
                title="Anexar imagem ou vídeo"
                aria-label="Anexar imagem ou vídeo"
              >
                <Paperclip size={16} />
              </Button>
              <div className="flex-1 relative">
                {/* Menções (@) (Fase 2, 21/07/2026, pedido do Vini) —
                    autocomplete simples: digitar "@" seguido de letras
                    (sem espaço) abre a lista de colegas, filtrada pelo que
                    foi digitado. */}
                {mencaoAtiva && mencaoOpcoes.length > 0 && (
                  <div className="absolute bottom-full mb-1 left-0 z-20 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] shadow-[var(--elevation-2)] py-1 w-56 max-h-40 overflow-y-auto">
                    {mencaoOpcoes.map((c) => (
                      <button
                        key={c.usuarioId}
                        onClick={() => escolherMencao(c)}
                        className="w-full text-left px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-1.5"
                      >
                        <PresencaDot status={presencas[c.usuarioId]} /> {c.nome}
                      </button>
                    ))}
                  </div>
                )}
                <TextArea
                  value={texto}
                  onChange={(e) => aoDigitar(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && mencaoAtiva) {
                      setMencaoAtiva(null);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                  placeholder="Escreva uma mensagem... (Enter envia, Shift+Enter quebra linha, @ menciona alguém)"
                  rows={1}
                  className="w-full resize-none"
                />
              </div>
              <Button variant="accent" onClick={enviar} disabled={enviando || (!texto.trim() && !arquivo)}>
                <Send size={16} />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Painel de thread (Fase 2, 21/07/2026) — respostas de UMA mensagem,
          com um mini-compose próprio; fecha ao clicar fora ou no X. */}
      {threadAberta && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setThreadAberta(null)}>
          <div
            className="bg-white dark:bg-slate-900 rounded-[var(--radius-card)] shadow-[var(--elevation-2)] w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <CornerUpLeft size={14} /> Thread
              </h4>
              <button onClick={() => setThreadAberta(null)} className="text-gray-400 dark:text-slate-500 hover:text-brand-600" aria-label="Fechar thread">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-sm flex-shrink-0">
              <p className="text-[10px] font-semibold text-gray-400 dark:text-slate-500 mb-0.5">{nomeExibicao(threadAberta.remetente)}</p>
              {threadAberta.conteudo && <p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{renderConteudoComMencoes(threadAberta.conteudo, user?.id)}</p>}
              {threadAberta.anexoUrl && <AnexoMensagem mensagem={threadAberta} />}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {carregandoThreadPainel ? (
                <LoadingState />
              ) : threadRespostas.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">Nenhuma resposta ainda.</p>
              ) : (
                threadRespostas.map((r) => (
                  <div key={r.id} className="flex flex-col gap-0.5">
                    <p className="text-[10px] font-semibold text-gray-400 dark:text-slate-500">{nomeExibicao(r.remetente)}</p>
                    <div className="bg-gray-100 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200">
                      {r.anexoUrl && <AnexoMensagem mensagem={r} />}
                      {r.conteudo && <p className="whitespace-pre-wrap break-words">{renderConteudoComMencoes(r.conteudo, user?.id)}</p>}
                      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{fmtHora(r.criadoEm)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-gray-100 dark:border-slate-700 flex gap-2 flex-shrink-0">
              <TextArea
                value={textoThread}
                onChange={(e) => setTextoThread(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviarRespostaThread();
                  }
                }}
                placeholder="Responder na thread..."
                rows={1}
                className="flex-1 resize-none"
              />
              <Button variant="accent" onClick={enviarRespostaThread} disabled={enviandoThread || !textoThread.trim()}>
                <Send size={16} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Arquivos compartilhados (Fase 2, 21/07/2026) — painel simples com
          todo anexo já trocado nesta conversa. */}
      {arquivosPainelAberto && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setArquivosPainelAberto(false)}>
          <div
            className="bg-white dark:bg-slate-900 rounded-[var(--radius-card)] shadow-[var(--elevation-2)] w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Folder size={14} /> Arquivos compartilhados
              </h4>
              <button
                onClick={() => setArquivosPainelAberto(false)}
                className="text-gray-400 dark:text-slate-500 hover:text-brand-600"
                aria-label="Fechar arquivos compartilhados"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {carregandoArquivos ? (
                <LoadingState />
              ) : arquivosCompartilhados.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">Nenhum arquivo compartilhado ainda nesta conversa.</p>
              ) : (
                arquivosCompartilhados.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-control)] p-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{m.anexoNomeOriginal || "Anexo"}</p>
                      <p className="text-[10px] text-gray-400 dark:text-slate-500">
                        {nomeExibicao(m.remetente)} · {fmtHora(m.criadoEm)} {m.anexoTamanhoBytes ? `· ${fmtTamanho(m.anexoTamanhoBytes)}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const { blob, nomeArquivo } = await mensagensApi.baixarAnexo(m.id);
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = nomeArquivo || m.anexoNomeOriginal || "anexo";
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch {
                          // silencioso — usuário pode tentar de novo
                        }
                      }}
                      className="text-gray-400 dark:text-slate-500 hover:text-brand-600 flex-shrink-0 p-1"
                      title="Baixar"
                      aria-label="Baixar"
                    >
                      <Download size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Histórico pesquisável (Fase 2, 21/07/2026, pedido do Vini) — busca
          global em todas as conversas acessíveis, resultado clicável navega
          direto pra conversa. */}
      {buscaHistoricoAberta && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-20"
          onClick={() => {
            setBuscaHistoricoAberta(false);
            setBuscaHistoricoQuery("");
            setBuscaHistoricoResultados([]);
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-[var(--radius-card)] shadow-[var(--elevation-2)] w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              <SearchBox value={buscaHistoricoQuery} onChange={buscarHistorico} placeholder="Buscar em todas as conversas e canais..." />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {buscandoHistorico ? (
                <div className="p-4 flex justify-center"><Spinner size={16} /></div>
              ) : buscaHistoricoQuery.trim().length < 2 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">Digite pelo menos 2 caracteres pra buscar.</p>
              ) : buscaHistoricoResultados.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">Nada encontrado.</p>
              ) : (
                buscaHistoricoResultados.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => abrirResultadoBusca(m)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-[var(--radius-control)]"
                  >
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {nomeExibicao(m.remetente)} <span className="text-gray-400 dark:text-slate-500 font-normal">· {fmtHora(m.criadoEm)}</span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5">{textoSemMencoes(m.conteudo)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {visualizarComoAberto && <VisualizarComoModal colaboradores={data.colaboradores} onFechar={() => setVisualizarComoAberto(false)} />}

      {novaConversaAberta && (
        <Modal
          title="Nova conversa"
          onClose={() => {
            setNovaConversaAberta(false);
            setBuscaContato("");
          }}
        >
          <SearchBox value={buscaContato} onChange={setBuscaContato} placeholder="Nome, setor, unidade ou cargo..." />
          <div className="mt-2 max-h-80 overflow-y-auto">
            {contatosFiltrados.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-slate-400 px-2 py-3 text-center">Ninguém encontrado.</p>
            ) : (
              // Sem corte de quantidade (22/07/2026, mesmo pedido do Vini) —
              // o painel já rola (max-h-80 overflow-y-auto acima), então
              // limitar a 20 resultados só escondia gente da lista completa
              // sem ganho nenhum de desempenho perceptível pro tamanho do
              // time.
              contatosFiltrados.map((c) => (
                <button
                  key={c.usuarioId}
                  onClick={() => {
                    setAlvo({ tipo: "DIRETA", usuarioId: c.usuarioId, nome: c.nome });
                    setBuscaContato("");
                    setNovaConversaAberta(false);
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-[var(--radius-control)] mt-1"
                >
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    👤 {c.nome} <PresencaDot status={presencas[c.usuarioId]} />
                  </span>
                  {(c.setor || c.unidade) && (
                    <span className="block text-[10px] text-gray-400 dark:text-slate-500">
                      {[c.setor, c.unidade].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// "Visualizar como" (22/07/2026, pedido implícito do Vini ao revisar a
// segmentação de canais de chat) — a conta de Administrador é irrestrita
// por desenho (ver PAPEIS_IRRESTRITOS em canaisMensagem.ts, backend), então
// olhando a própria tela nunca dava pra confirmar visualmente que um papel
// restrito (Gestor/Financeiro/Colaborador) está vendo só o setor/unidade
// dele. Este modal deixa o Administrador escolher qualquer colaborador com
// login e ver exatamente a árvore de canais que ELE veria — só leitura,
// nunca abre a conversa nem manda mensagem em nome de ninguém (a rota no
// backend, GET /mensagens/canais-disponiveis/como/:usuarioId, também é
// travada só pra ADMINISTRADOR e só devolve a lista, nunca o conteúdo).
function VisualizarComoModal({ colaboradores, onFechar }: { colaboradores: AppData["colaboradores"]; onFechar: () => void }) {
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<{ usuarioId: string; nome: string; papel: string } | null>(null);
  const [resultado, setResultado] = useState<{ usuario: { id: string; papel: string; nome: string | null }; canais: CanaisDisponiveis } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const comLogin = useMemo(
    () =>
      colaboradores
        .filter((c) => c.usuario)
        .filter((c) => !busca.trim() || c.nomeCompleto.toLowerCase().includes(busca.trim().toLowerCase()))
        .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto)),
    [colaboradores, busca]
  );

  async function selecionar(usuarioId: string, nome: string, papel: string) {
    setSelecionado({ usuarioId, nome, papel });
    setResultado(null);
    setErro(null);
    setCarregando(true);
    try {
      const r = await mensagensApi.canaisDisponiveisComo(usuarioId);
      setResultado(r);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os canais deste usuário.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Modal title="Visualizar canais como outro usuário" onClose={onFechar} wide>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
        Sua conta de Administrador enxerga todos os canais por padrão — use isto pra conferir exatamente o que um Gestor, Financeiro ou
        Colaborador específico veria, sem precisar da senha dele. Só leitura: não abre a conversa nem envia nada em nome de ninguém.
      </p>
      <div className="flex gap-3">
        <div className="w-56 flex-shrink-0 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden flex flex-col max-h-96">
          <div className="p-2 border-b border-gray-100 dark:border-slate-700">
            <SearchBox value={busca} onChange={setBusca} placeholder="Buscar colaborador..." />
          </div>
          <div className="overflow-y-auto">
            {comLogin.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 p-3 text-center">Ninguém encontrado.</p>
            ) : (
              comLogin.map((c) => (
                <button
                  key={c.id}
                  onClick={() => c.usuario && selecionar(c.usuario.id, c.nomeCompleto, c.usuario.papel)}
                  className={`w-full text-left px-3 py-2 text-xs border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 ${
                    selecionado?.usuarioId === c.usuario?.id ? "bg-brand-50 dark:bg-brand-500/15" : ""
                  }`}
                >
                  <p className="font-medium text-slate-800 dark:text-slate-200">{c.nomeCompleto}</p>
                  <p className="text-gray-400 dark:text-slate-500">{c.usuario?.papel}</p>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {!selecionado ? (
            <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-10">Escolha alguém na lista à esquerda.</p>
          ) : carregando ? (
            <div className="flex justify-center py-10"><Spinner size={20} /></div>
          ) : erro ? (
            <p className="text-xs text-brand-700 dark:text-brand-400 py-4">{erro}</p>
          ) : resultado ? (
            <div className="text-xs space-y-3 max-h-96 overflow-y-auto pr-1">
              <p className="text-slate-700 dark:text-slate-300">
                <span className="font-semibold">{resultado.usuario.nome || selecionado.nome}</span> ({resultado.usuario.papel})
                {resultado.canais.irrestrito && (
                  <span className="ml-1.5 text-gray-400 dark:text-slate-500">— papel irrestrito, vê todos os canais por desenho.</span>
                )}
              </p>
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-200"># {resultado.canais.canalEmpresa.nome}</p>
              </div>
              {resultado.canais.setoresGlobais.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500 mb-1">Setores globais</p>
                  {resultado.canais.setoresGlobais.map((s) => (
                    <p key={s.id} className="text-slate-700 dark:text-slate-300"># {s.nome}</p>
                  ))}
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500 mb-1">Unidades</p>
                {resultado.canais.unidades.length === 0 ? (
                  <p className="text-gray-400 dark:text-slate-500">Nenhum canal de unidade liberado.</p>
                ) : (
                  resultado.canais.unidades.map((u) => (
                    <div key={u.id} className="mb-2">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{u.nome}</p>
                      <div className="pl-3">
                        {u.acessoEquipe && <p className="text-slate-700 dark:text-slate-300"># Minha Equipe</p>}
                        {u.setores.map((s) => (
                          <p key={s.id} className="text-slate-700 dark:text-slate-300"># {s.nome}</p>
                        ))}
                        {!u.acessoEquipe && u.setores.length === 0 && <p className="text-gray-400 dark:text-slate-500">Nenhum canal liberado.</p>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <Button variant="ghost" onClick={onFechar}>Fechar</Button>
      </div>
    </Modal>
  );
}
