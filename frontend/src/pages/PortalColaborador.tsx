import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { chamadosApi, ChamadoInput, Tecnico } from "../api/chamados";
import { solicitacoesApi, SolicitacaoInput } from "../api/solicitacoes";
import { ItemSolicitacaoPapelariaInput, solicitacoesPapelariaApi } from "../api/solicitacoesPapelaria";
import { ApiError } from "../lib/apiClient";
import { solicitacoesServicoApi } from "../api/solicitacoesServico";
import { DetalheServico } from "./SolicitacoesServico";
import { useFeedback } from "../contexts/FeedbackContext";
import { abrirChamadoComSuporteOffline } from "../offline/abrirChamado";
import { useChamadosPendentes } from "../offline/useConexao";
import { DestinoNotificacao } from "../lib/notificacaoDestino";
import { maskTelefone } from "../lib/mascaras";
import { perfilApi, PagamentoDoPortal } from "../api/perfil";
import { colaboradoresApi } from "../api/colaboradores";
import { equipamentosApi } from "../api/equipamentos";
import {
  Accordion, Button, CARD_SHADOW, cardClicavelProps, Field, fmtDate, fmtMoney, FOCUS_RING_CLASS, FONT_DISPLAY, FONT_MONO,
  LoadingState, Modal, Select, Spinner, Stamp, TextArea, TextInput, useAccordions,
} from "../components/ui";
import { SeletorAnexos } from "../components/SeletorAnexos";
import {
  CheckCircle2, Download, FileText, Key, Laptop, MessageCircle, Package, Phone, Plus, Send, ShoppingCart, Sparkles, Wrench, X,
} from "../components/icons";
import { LOGO_DATA_URI } from "../assets/logo";
import { ChamadoDetalhe, fmtDataHora } from "../components/ChamadoDetalhe";
import { MensagensPage } from "./Mensagens";
import { DocumentosRH } from "../components/DocumentosRH";
import { AnexosEquipamento } from "./Equipamentos";
import {
  CATEGORIA_CHAMADO_LABEL, CATEGORIAS_CHAMADO_CRIAVEIS, CategoriaChamado, Colaborador, Equipamento, Prioridade, SolicitacaoEquipamento, SolicitacaoPapelaria, SolicitacaoServico,
  TIPO_SOLICITACAO_IMOVIEW_LABEL, TIPOS_SOLICITACAO_IMOVIEW, TipoSolicitacaoImoview,
  STATUS_ACESSO_LABEL, STATUS_ACESSO_TONE, STATUS_CHAMADO_LABEL, STATUS_CHAMADO_TONE, STATUS_EQUIPAMENTO_LABEL, STATUS_EQUIPAMENTO_TONE,
  STATUS_LINHA_LABEL, STATUS_LINHA_TONE, STATUS_PAGAMENTO_LABEL, STATUS_PAGAMENTO_TONE,
  STATUS_SOLICITACAO_LABEL, STATUS_SOLICITACAO_TONE, STATUS_SOLICITACAO_PAPELARIA_LABEL, STATUS_SOLICITACAO_PAPELARIA_TONE,
  STATUS_SERVICO_LABEL, STATUS_SERVICO_TONE, StatusSolicitacaoPapelaria,
  TIPO_PAGAMENTO_LABEL, TIPO_SOLICITACAO_PAPELARIA_LABEL, Unidade, UNIDADE_MEDIDA_PRODUTO_LABEL,
  FORMA_PAGAMENTO_LABEL, rotuloEquipamento,
} from "../types";

interface Props {
  data: AppData;
  colaboradorId: string | null;
  onChanged: () => void;
}

// Pop-up de notificação clicável (09/07/2026, pedido do Vini) — o Portal não
// tem "módulo" como o AppShell (ver App.tsx), tem `tela` + um id
// selecionado por vez (chamadoSelecionadoId, papelariaSelecionadaId etc.,
// todos internos a este componente). Como quem renderiza <CentralNotificacoes>
// pro Portal é o App.tsx (mesma barra de cabeçalho usada em toda a
// aplicação, fora da árvore deste componente), a única forma de repassar
// "abre isso" pra dentro do Portal sem duplicar a barra inteira aqui é uma
// API imperativa via ref — exposta só com o método que o App.tsx precisa
// chamar, nada além disso.
export interface PortalColaboradorHandle {
  abrirDestino: (destino: DestinoNotificacao) => void;
  // Comunicação unificada (21/07/2026) — o sino de notificações no
  // cabeçalho ganhou um atalho "Mensagens" (ver CentralNotificacoes.tsx);
  // aqui é só trocar a tela interna, sem precisar montar um
  // DestinoNotificacao falso pra reaproveitar `abrirDestino`.
  abrirMensagens: () => void;
}

// Selo colorido por tipo (Onda 2.4 do redesenho, 21/07/2026) — mesmo
// ícone/rótulo já usados em <EscolhaTipoSolicitacaoModal> logo abaixo
// (mesma tela, mesmo vocabulário visual), só com uma cor de fundo própria
// pra distinguir os 4 tipos numa lista combinada de relance, sem precisar
// ler o texto do rótulo. Deliberadamente local a este arquivo (não em
// ui.tsx) — só tem um consumidor até agora; se um segundo (ex: a "Fila" de
// quem atende, se um dia existir) precisar do mesmo selo, aí sim vale
// promover pra um componente compartilhado.
const SELO_TIPO_SOLIC: Record<
  "chamado" | "equipamento" | "papelaria" | "servico",
  { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; className: string }
> = {
  chamado: { icon: Wrench, label: "Chamado", className: "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  equipamento: { icon: Laptop, label: "Equipamento", className: "bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400" },
  papelaria: { icon: Package, label: "Papelaria", className: "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  servico: { icon: Sparkles, label: "Serviço", className: "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400" },
};

// Diferente do protótipo (que tinha um <select> "Você é:" — qualquer pessoa
// com o link podia se passar por outra), aqui o colaborador logado já vem
// identificado pelo próprio token JWT (colaboradorId embutido no login).
// Sem seletor: portal mostra sempre e apenas os dados da própria pessoa —
// e o backend garante isso também (GET /equipamentos, /linhas-telefonicas e
// /acessos-sistema já vêm filtrados pelo servidor pra quem é COLABORADOR,
// não é só uma questão de esconder na tela).
export const PortalColaborador = React.forwardRef<PortalColaboradorHandle, Props>(function PortalColaborador(
  { data, colaboradorId, onChanged },
  ref
) {
  // "mensagens" (08/07/2026, pedido do Vini: chat interno passa a valer
  // também pro Portal do Colaborador, que antes não tinha nenhuma tela de
  // mensagem) usa um container mais largo que as outras telas — ver
  // `className` do wrapper mais abaixo — porque o layout de duas colunas do
  // MensagensPage (lista de canais + conversa) não cabe confortavelmente no
  // max-w-lg (512px) usado pelo resto do Portal, pensado pra formulário de
  // uma coluna só.
  const [tela, setTela] = useState<"inicio" | "chamado" | "solicitacao" | "papelaria" | "servico" | "mensagens" | "documentos">("inicio");
  // "Nova Solicitação" única (Onda 1 do redesenho, 21/07/2026) — controla o
  // modal de escolha guiada que decide, por baixo, qual dos 4 `setTela(...)`
  // de sempre chamar. Ver <EscolhaTipoSolicitacaoModal> mais abaixo.
  const [escolhendoTipo, setEscolhendoTipo] = useState(false);
  const [enviado, setEnviado] = useState(false);
  // Abertura de Chamados Offline (08/07/2026, item 1): distingue "chegou no
  // servidor de verdade" de "guardado no aparelho, aguardando conexão" — a
  // tela de sucesso mostra uma mensagem diferente pra cada caso (ver JSX
  // mais abaixo), porque são estados bem diferentes do ponto de vista do
  // colaborador (um já está no sistema, o outro ainda depende da rede).
  const [modoEnvio, setModoEnvio] = useState<"enviado" | "pendente" | null>(null);
  const [avisoAnexos, setAvisoAnexos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chamadosPendentes = useChamadosPendentes();
  const [chamadoSelecionadoId, setChamadoSelecionadoId] = useState<string | null>(null);
  // Correção de fluxo (09/07/2026, pedido do Vini): colaborador agora abre a
  // própria solicitação de Papelaria e Compras pelo Portal — mesmo padrão de
  // "seleciona pra ver detalhe/comentar" já usado acima pra chamadoSelecionadoId.
  const [papelariaSelecionadaId, setPapelariaSelecionadaId] = useState<string | null>(null);
  // Achado de auditoria S5 (22/07/2026): item de Equipamento na lista
  // unificada não respondia a clique/toque (ver comentário mais abaixo, em
  // `minhasSolicUnificadas`) — quebra em touch, porque não existe "hover"
  // pra descobrir que não é clicável antes de tocar. Em vez de só tirar a
  // aparência de clicável, abre uma ficha simples e só-leitura (o objeto já
  // vem completo em `data.solicitacoes`, sem precisar de outra chamada à
  // API) — mesmo racional de PortalPapelariaDetalhe/DetalheServico, só que
  // sem timeline própria (SolicitacaoEquipamento não tem uma).
  const [equipamentoSolicSelecionada, setEquipamentoSolicSelecionada] = useState<SolicitacaoEquipamento | null>(null);
  // Pop-up de notificação (09/07/2026): usuário-alvo pra abrir direto numa
  // conversa direta específica em Mensagens, vindo de uma notificação
  // MENSAGEM (ver abrirDestino logo abaixo). `undefined` = comportamento
  // normal do módulo (nenhuma conversa pré-selecionada).
  const [conversaAlvoUsuarioId, setConversaAlvoUsuarioId] = useState<string | undefined>(undefined);
  // Mesma ideia, pra clique num pop-up de notificação de mensagem de canal
  // (09/07/2026, pedido do Vini: "quero que os canais fiquem nos recentes
  // também" + notificação clicável) — ver abrirDestino logo abaixo.
  const [canalAlvo, setCanalAlvo] = useState<{ tipo: "unidade" | "setor" | "setor-unidade" | "empresa"; id: string } | undefined>(
    undefined
  );
  // Lista de técnicos pro seletor obrigatório "Técnico responsável" (achado
  // do Vini, 07/07/2026: local e técnico passam a ser escolha obrigatória já
  // na abertura do chamado/solicitação — hoje só existe o próprio Vini na
  // lista, mas o seletor já vem pronto pra quando houver mais gente no
  // Suporte de TI). Buscado uma vez aqui e repassado pros dois formulários.
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([]);
  useEffect(() => {
    chamadosApi.tecnicos().then(setTecnicos).catch(() => setTecnicos([]));
  }, []);

  // Meus pagamentos (21/07/2026, pedido do Vini: "a folha de pagamento não
  // ficou disponível para os colaboradores no portal"). Diferente dos
  // outros itens desta tela (equipamentos, linhas, acessos, chamados...),
  // pagamento não vem em `data` (AppData) — é buscado à parte pela mesma
  // rota de autoatendimento usada no menu do usuário (/perfil/...), porque
  // a rota de gestão (/colaboradores/:id/pagamentos) exige papel de
  // RH/Financeiro/Admin, que o colaborador comum nunca tem. Ver
  // GET /perfil/pagamentos em perfil.routes.ts (backend) — filtra sempre
  // pelo colaboradorId do próprio token, nunca aceita ver de outra pessoa.
  const [meusPagamentos, setMeusPagamentos] = useState<PagamentoDoPortal[]>([]);
  useEffect(() => {
    perfilApi.meusPagamentos().then(setMeusPagamentos).catch(() => setMeusPagamentos([]));
  }, []);

  // Minhas solicitações de Serviço (Onda 2.4 do redesenho, 21/07/2026 —
  // item 9 da auditoria: "Listagem unificada"). Achado real ao implementar
  // este item: o Portal nunca teve NENHUMA seção listando as próprias
  // solicitações de Serviço — dava pra criar uma (`PortalServicoForm`, tela
  // "servico") mas depois não existia onde acompanhar o status. As outras 3
  // (chamado/equipamento/papelaria) já vinham prontas em `data` (AppData);
  // Serviço não está lá (só é buscado sob demanda por quem gerencia, ver
  // SolicitacoesServico.tsx) — busca própria aqui, mesmo padrão de
  // `meusPagamentos` acima. O backend já escopa pra só as próprias (ver
  // GET /solicitacoes-servico em solicitacoesServico.routes.ts — mesma regra
  // de `solicitanteId` aplicada a Papelaria), então não precisa filtrar de
  // novo no cliente (mesmo racional do comentário de `minhasSolicPapelaria`
  // logo abaixo).
  const [minhasServ, setMinhasServ] = useState<SolicitacaoServico[]>([]);
  const recarregarServ = useCallback(() => {
    solicitacoesServicoApi.list().then(setMinhasServ).catch(() => {});
  }, []);
  useEffect(() => { recarregarServ(); }, [recarregarServ]);
  // Solicitação de serviço aberta pra detalhe (ver <DetalheServico>,
  // reaproveitado de SolicitacoesServico.tsx sem nenhuma mudança lá — com
  // ehTI/ehFinanceiro falsos, o componente já degrada sozinho pra
  // só-leitura, ver comentário na exportação dele).
  const [servicoSelecionado, setServicoSelecionado] = useState<SolicitacaoServico | null>(null);

  // Onda 1 do redesenho (21/07/2026, pedido do Vini: "informações abertas
  // devem virar cards retráteis") — "Meus itens" e "Meus chamados" já
  // começam abertos (é o que a maioria vem ao Portal consultar primeiro);
  // o resto começa fechado, 1 clique pra expandir.
  const accInicio = useAccordions(["meus-itens", "meus-chamados"]);

  async function baixarMeuRecibo(pagamentoId: string, competencia: string) {
    try {
      const { blob } = await perfilApi.baixarMeuRecibo(pagamentoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recibo-${competencia.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível baixar o recibo.");
    }
  }

  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — ver
  // PortalColaboradorHandle acima. Chamado e Papelaria já tinham modal de
  // detalhe (chamadoSelecionadoId/papelariaSelecionadaId, usados também
  // quando o colaborador clica direto num item da lista "Início"); Mensagem
  // Direta ganha pré-seleção de conversa. As demais categorias não têm um
  // "detalhe" próprio no Portal — a tela "Início" já mostra tudo (Meus
  // itens, Minhas solicitações), então o destino possível é só garantir que
  // o colaborador está olhando pra lá.
  useImperativeHandle(
    ref,
    () => ({
      abrirDestino(destino: DestinoNotificacao) {
        switch (destino.tipo) {
          case "chamado":
            setTela("inicio");
            setChamadoSelecionadoId(destino.id);
            break;
          case "solicitacaoPapelaria":
            setTela("inicio");
            setPapelariaSelecionadaId(destino.id);
            break;
          case "mensagemDireta":
            setConversaAlvoUsuarioId(destino.usuarioId);
            setTela("mensagens");
            break;
          case "mensagemCanal":
            setCanalAlvo({ tipo: destino.canalTipo, id: destino.id });
            setTela("mensagens");
            break;
          case "solicitacaoEquipamento":
          case "equipamento":
          case "linha":
          case "colaborador":
          case "movimentacoes":
          case "calendarioAniversarios":
          case "pagamento":
            setTela("inicio");
            break;
          case "nenhum":
          default:
            break;
        }
      },
      abrirMensagens() {
        setTela("mensagens");
      },
    }),
    []
  );

  const meuColaborador = data.colaboradores.find((c) => c.id === colaboradorId);
  // Achado do Vini (07/07/2026): mesmo filtro aplicado em Chamados.tsx/
  // Solicitacoes.tsx — "Não identificado" é um valor técnico do backfill da
  // migration, não uma opção pra quem abre chamado/solicitação escolher.
  const unidadesSelecionaveis = data.dominios.unidades.filter((u) => u.nome !== "Não identificado");

  if (!colaboradorId || !meuColaborador) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          Seu usuário não está vinculado a um cadastro de colaborador. Fale com o RH ou com o administrador do
          sistema para regularizar seu acesso ao Portal.
        </p>
      </div>
    );
  }

  async function abrirChamado(form: Omit<ChamadoInput, "solicitanteId">, arquivos: File[]) {
    setEnviando(true);
    setErro(null);
    setAvisoAnexos([]);
    try {
      const resultado = await abrirChamadoComSuporteOffline({ ...form, solicitanteId: colaboradorId! }, arquivos);
      if (resultado.modo === "enviado") {
        await onChanged();
        setAvisoAnexos(resultado.anexosComErro);
      }
      setModoEnvio(resultado.modo);
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }
  async function abrirSolicitacao(form: Omit<SolicitacaoInput, "solicitanteId">) {
    setEnviando(true);
    setErro(null);
    try {
      await solicitacoesApi.create({ ...form, solicitanteId: colaboradorId! });
      await onChanged();
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  // Correção de fluxo (09/07/2026, pedido do Vini: "o intuito seria os
  // colaboradores solicitar e o RH autorizar ou não, definir se é urgente ou
  // não"). Colaborador só descreve o que precisa (unidade + itens +
  // observação) — nunca escolhe Mensal/Avulsa nem prioridade; o backend
  // força esses campos pro servidor de qualquer forma (ver POST
  // /solicitacoes-papelaria em solicitacoesPapelaria.routes.ts), então nem
  // aparecem no formulário abaixo. Quem decide se é urgente é o RH,
  // reclassificando a solicitação antes de aprovar.
  async function abrirPapelaria(form: { unidadeId: string; observacoes: string; itens: ItemSolicitacaoPapelariaInput[] }) {
    setEnviando(true);
    setErro(null);
    try {
      await solicitacoesPapelariaApi.create({
        unidadeId: form.unidadeId,
        // Valor sempre ignorado pelo backend quando quem cria é COLABORADOR
        // (forçado pra MENSAL/MEDIA no servidor) — enviado só pra satisfazer
        // o contrato de tipos do cliente de API, não é uma escolha real feita
        // aqui na tela.
        tipo: "MENSAL",
        observacoes: form.observacoes || null,
        itens: form.itens,
        enviarAgora: true,
      });
      await onChanged();
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  const minhasSolic = data.solicitacoes.filter((s) => s.solicitanteId === colaboradorId);
  // Diferente de `minhasSolic` acima (Colaborador, dono do registro), aqui
  // não precisa filtrar no cliente: o backend já devolve só as PRÓPRIAS
  // solicitações de Papelaria pra quem é COLABORADOR (ver escopoColaborador
  // em solicitacoesPapelaria.routes.ts) — a lista de `data.solicitacoesPapelaria`
  // já chega escopada, porque este componente só é renderizado pra quem tem
  // papel COLABORADOR (ver App.tsx).
  const minhasSolicPapelaria = data.solicitacoesPapelaria;
  const meusChamados = data.chamados.filter((c) => c.solicitanteId === colaboradorId);
  const meusEquipamentos = data.equipamentos.filter((e) => e.colaboradorId === colaboradorId);
  const minhasLinhas = data.linhas.filter((l) => l.colaboradorId === colaboradorId);
  const meusAcessos = data.acessos.filter((a) => a.colaboradorId === colaboradorId);

  // Listagem unificada "Minhas Solicitações" (Onda 2.4 do redesenho,
  // 21/07/2026 — item 9 da auditoria): os 4 tipos numa timeline só, mais
  // recente primeiro, com um selo colorido por tipo (ver `SELO_TIPO_SOLIC`
  // abaixo) — igual à proposta da seção 2.2 da auditoria ("reaproveitando
  // Stamp/KanbanBoard... alimentados por chamadas de API combinadas no
  // frontend, sem precisar de tabela única no banco"). Continua sendo só
  // camada visual: cada item abre exatamente o mesmo modal de detalhe de
  // sempre (`ChamadoDetalhe`/`PortalPapelariaDetalhe`/`DetalheServico`), os
  // 4 modelos de dados por baixo não mudam em nada. Equipamento GANHOU
  // `onClick` em 22/07/2026 (achado de auditoria S5) — antes ficava sem,
  // "de propósito" (nunca teve modal de detalhe pro colaborador), mas na
  // prática o item continuava com a mesma aparência dos outros 3 tipos
  // clicáveis (mesmo card, mesma borda) — sem hover pra avisar em telas de
  // toque, virava um "clique morto" sem explicação. Resolvido abrindo uma
  // ficha simples e só-leitura (ver <EquipamentoSolicDetalhe> abaixo) em vez
  // de tirar a aparência de clicável.
  const minhasSolicUnificadas = useMemo(() => {
    const itens: {
      key: string; tipo: "chamado" | "equipamento" | "papelaria" | "servico";
      data: string; titulo: string; status: string; tone: "pos" | "neg" | "pend"; onClick?: () => void;
    }[] = [
      ...meusChamados.map((c) => ({
        key: `chamado-${c.id}`, tipo: "chamado" as const, data: c.dataAbertura,
        titulo: `#${c.numero} · ${CATEGORIA_CHAMADO_LABEL[c.categoria]}`,
        status: STATUS_CHAMADO_LABEL[c.status], tone: STATUS_CHAMADO_TONE[c.status],
        onClick: () => setChamadoSelecionadoId(c.id),
      })),
      ...minhasSolic.map((s) => ({
        key: `equip-${s.id}`, tipo: "equipamento" as const, data: s.dataSolicitacao,
        titulo: `#${s.numero} · ${s.item}`, status: STATUS_SOLICITACAO_LABEL[s.status], tone: STATUS_SOLICITACAO_TONE[s.status],
        onClick: () => setEquipamentoSolicSelecionada(s),
      })),
      ...minhasSolicPapelaria.map((s) => ({
        key: `papelaria-${s.id}`, tipo: "papelaria" as const, data: s.criadoEm,
        titulo: `#${s.numero} · ${s._count?.itens ?? 0} ${s._count?.itens === 1 ? "item" : "itens"}`,
        status: STATUS_SOLICITACAO_PAPELARIA_LABEL[s.status], tone: STATUS_SOLICITACAO_PAPELARIA_TONE[s.status],
        onClick: () => setPapelariaSelecionadaId(s.id),
      })),
      ...minhasServ.map((s) => ({
        key: `servico-${s.id}`, tipo: "servico" as const, data: s.criadoEm,
        titulo: `#${s.numero} · ${s.servico}`, status: STATUS_SERVICO_LABEL[s.status], tone: STATUS_SERVICO_TONE[s.status],
        onClick: () => setServicoSelecionado(s),
      })),
    ];
    return itens.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, [meusChamados, minhasSolic, minhasSolicPapelaria, minhasServ]);

  // Contagem de documentos que exigem ação do colaborador agora (11/08/2026,
  // Fase RH) — usado só pro badge do botão "Meus Documentos" acima.
  const documentosPendentesAcao = useMemo(
    () => data.documentos.filter((d) => d.status === "SOLICITADO" || d.status === "REJEITADO").length,
    [data.documentos]
  );

  return (
    <div className={tela === "mensagens" ? "max-w-5xl mx-auto" : "max-w-lg mx-auto"}>
      <div className="text-center mb-7">
        <div className="inline-flex bg-slate-900 rounded-2xl p-3.5 mb-3 shadow-lg shadow-slate-900/10">
          <img src={LOGO_DATA_URI} alt="Administrar Imóveis" className="h-9" />
        </div>
        <h2 className="text-2xl" style={{ fontFamily: FONT_DISPLAY, fontWeight: 800 }}>
          <span className="text-slate-900 dark:text-slate-100">ADMINISTRAR</span> <span className="text-brand-600">IMÓVEIS</span>
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Portal do Colaborador — {meuColaborador.nomeCompleto}</p>
      </div>

      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2.5">{erro}</div>}

      {enviado ? (
        // Abertura de Chamados Offline (08/07/2026, item 1): "pendente" e
        // "enviado" são estados genuinamente diferentes pro colaborador —
        // um já virou um chamado real no sistema, o outro só será enviado
        // quando a conexão voltar (ver IndicadorConexao no topo da tela
        // pra acompanhar). Amarelo em vez de verde comunica isso à
        // primeira vista, sem precisar ler o texto.
        <div
          className={`border rounded-[var(--radius-card)] p-5 text-center mb-6 ${modoEnvio === "pendente" ? "bg-amber-50 dark:bg-amber-500/15 border-amber-200 dark:border-amber-800" : "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-800"}`}
          style={{ boxShadow: CARD_SHADOW }}
        >
          <CheckCircle2 className={`mx-auto mb-2 ${modoEnvio === "pendente" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`} size={28} />
          {modoEnvio === "pendente" ? (
            <>
              <p className="text-sm text-amber-900 dark:text-amber-300 font-semibold">Salvo neste aparelho — sem conexão no momento.</p>
              <p className="text-xs text-amber-800 dark:text-amber-400 mt-1">
                Assim que a conexão voltar, o chamado é enviado automaticamente. Acompanhe pelo indicador no topo da tela.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-emerald-800 dark:text-emerald-300 font-semibold">Enviado com sucesso!</p>
              {avisoAnexos.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
                  O chamado foi criado, mas {avisoAnexos.length === 1 ? "este anexo não pôde" : "estes anexos não puderam"} ser enviado{avisoAnexos.length === 1 ? "" : "s"}: {avisoAnexos.join(", ")}.
                </p>
              )}
            </>
          )}
          <Button variant="ghost" className="mt-3" onClick={() => { setTela("inicio"); setEnviado(false); setModoEnvio(null); }}>Voltar</Button>
        </div>
      ) : tela === "inicio" ? (
        <div className="space-y-2 mb-7">
          {/* Nova Solicitação única (Onda 1 do redesenho, 21/07/2026, pedido
              do Vini: "eliminar completamente essa divisão da Home... o
              colaborador não precisa entender como a empresa está
              organizada, o sistema deve decidir isso por ele"). Os 4
              botões de "pedir alguma coisa" (Chamado/Equipamento/
              Papelaria/Serviço) viraram 1 botão + 1 passo de decisão
              guiada (ver <EscolhaTipoSolicitacaoModal> abaixo) — por baixo
              continua abrindo exatamente a mesma tela de sempre
              (`setTela(...)`), nenhuma rota nem regra de negócio muda,
              só o ponto de entrada. "Mensagens" fica de fora dessa fusão
              de propósito: não é um tipo de solicitação, é conversa com
              um colega — continua com botão próprio (e também acessível
              pelo sino de notificações no topo, ver CentralNotificacoes). */}
          <Button
            data-tour="portal-nova-solicitacao"
            variant="primary"
            className="w-full justify-center py-4 text-[15px]"
            onClick={() => setEscolhendoTipo(true)}
          >
            <Plus size={17} /> Nova Solicitação
          </Button>
          <Button data-tour="portal-mensagens" variant="ghost" className="w-full justify-center py-3 border border-gray-200 dark:border-slate-700" onClick={() => setTela("mensagens")}>
            <MessageCircle size={16} /> Mensagens
          </Button>
          {/* Documentos (RH) (11/08/2026, Fase RH) — mesmo padrão de botão
              próprio de Mensagens acima: não é um tipo de "solicitação" (não
              passa pelo modal de escolha guiada), é autoatendimento com o
              RH. Nome "Documentos (RH)" de propósito, pra não colidir com o
              acordeão "Meus documentos" (patrimônio: termo de
              responsabilidade + anexos de equipamento) já existente mais
              abaixo — assuntos diferentes. Badge de pendência conta
              documentos que exigem uma ação DO colaborador agora
              (SOLICITADO = precisa enviar; REJEITADO = precisa reenviar) —
              não conta ENVIADO/EM_ANALISE, que é "a bola está com o RH". */}
          <Button
            variant="ghost"
            className="w-full justify-center py-3 border border-gray-200 dark:border-slate-700"
            onClick={() => setTela("documentos")}
          >
            <FileText size={16} /> Documentos (RH)
            {documentosPendentesAcao > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold">
                {documentosPendentesAcao}
              </span>
            )}
          </Button>
        </div>
      ) : tela === "mensagens" ? (
        <div className="mb-7">
          <Button variant="ghost" className="mb-3" onClick={() => setTela("inicio")}>Voltar</Button>
          <MensagensPage data={data} abrirConversaComUsuarioId={conversaAlvoUsuarioId} abrirCanal={canalAlvo} />
        </div>
      ) : tela === "documentos" ? (
        <div className="mb-7">
          <Button variant="ghost" className="mb-3" onClick={() => setTela("inicio")}>Voltar</Button>
          <DocumentosRH documentos={data.documentos} onChanged={onChanged} />
        </div>
      ) : tela === "servico" ? (
        <PortalServicoForm
          solicitanteId={meuColaborador.id}
          unidadeIdPadrao={meuColaborador.unidadeId}
          unidades={unidadesSelecionaveis}
          onBack={() => setTela("inicio")}
          onEnviado={() => { setTela("inicio"); }}
        />
      ) : tela === "chamado" ? (
        <PortalChamadoForm
          onSubmit={abrirChamado}
          onBack={() => setTela("inicio")}
          enviando={enviando}
          unidades={unidadesSelecionaveis}
          tecnicos={tecnicos}
          unidadeIdPadrao={meuColaborador.unidadeId}
          // Seletor de equipamento (07/08/2026, pedido do Vini) — só os
          // equipamentos do PRÓPRIO colaborador (mesma lista de
          // `meusEquipamentos` já usada na aba "Meus Documentos" desta
          // página), com mensagem clara quando não tiver nenhum. O backend
          // (POST /chamados-manutencao) recusa com 403 qualquer
          // equipamentoId que não pertença ao solicitante quando quem abre
          // é COLABORADOR — este filtro aqui é só pra nunca oferecer uma
          // opção que o servidor vai rejeitar.
          meusEquipamentos={meusEquipamentos}
        />
      ) : tela === "solicitacao" ? (
        <PortalSolicitacaoForm
          onSubmit={abrirSolicitacao}
          onBack={() => setTela("inicio")}
          enviando={enviando}
          unidades={unidadesSelecionaveis}
          tecnicos={tecnicos}
          categorias={data.dominios.categoriasProdutoEquipamento}
          produtos={data.dominios.produtosEquipamento}
          unidadeIdPadrao={meuColaborador.unidadeId}
        />
      ) : (
        <PortalPapelariaForm
          onSubmit={abrirPapelaria}
          onBack={() => setTela("inicio")}
          enviando={enviando}
          unidades={unidadesSelecionaveis}
          produtos={data.dominios.produtosPapelaria}
          categorias={data.dominios.categoriasProdutoPapelaria}
          unidadeIdPadrao={meuColaborador.unidadeId}
        />
      )}

      {tela === "inicio" && !enviado && (
        <div>
          <Accordion
            titulo="Meus itens"
            aberto={accInicio.estaAberto("meus-itens")}
            onToggle={() => accInicio.alternar("meus-itens")}
          >
            <div className="divide-y divide-gray-100 dark:divide-slate-800 -mx-1">
              <PortalItemLinha
                icon={Laptop}
                label={meusEquipamentos.length === 1 ? "Equipamento" : "Equipamentos"}
                vazio="Nenhum equipamento vinculado ao seu cadastro."
              >
                {meusEquipamentos.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                      {e.tipo}{e.modelo ? ` · ${e.modelo}` : ""}
                      {e.numeroSerie && <span className="text-gray-400 dark:text-slate-500"> · nº {e.numeroSerie}</span>}
                    </span>
                    <Stamp tone={STATUS_EQUIPAMENTO_TONE[e.status]}>{STATUS_EQUIPAMENTO_LABEL[e.status]}</Stamp>
                  </div>
                ))}
              </PortalItemLinha>

              <PortalItemLinha icon={Phone} label="Linha telefônica" vazio="Nenhuma linha vinculada ao seu cadastro.">
                {minhasLinhas.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm text-slate-700 dark:text-slate-300" style={{ fontFamily: "monospace" }}>{maskTelefone(l.numero)}</span>
                    <Stamp tone={STATUS_LINHA_TONE[l.status]}>{STATUS_LINHA_LABEL[l.status]}</Stamp>
                  </div>
                ))}
              </PortalItemLinha>

              <PortalItemLinha icon={Key} label="Acessos a sistemas" vazio="Nenhum acesso a sistema vinculado ao seu cadastro.">
                {meusAcessos.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm text-slate-700 dark:text-slate-300">{a.sistema?.nome || "—"}</span>
                    <Stamp tone={STATUS_ACESSO_TONE[a.status]}>{STATUS_ACESSO_LABEL[a.status]}</Stamp>
                  </div>
                ))}
              </PortalItemLinha>
            </div>
          </Accordion>

          {/* Meus documentos (21/07/2026, pedido do Vini: "o termo de
              responsabilidade e os demais documentos ficarem tudo no portal
              do colaborador") — antes só existia do lado admin (Colaboradores
              e Equipamentos), o colaborador não tinha como ver o próprio
              termo assinado nem os anexos dos equipamentos que usa. Tudo
              aqui é somente-leitura (mesmo componente AnexosEquipamento do
              módulo Patrimônio, com `readOnly`) — quem gera/anexa/remove
              continua sendo só ADMINISTRADOR/SUPORTE_TI, esta seção é só
              consulta e download. */}
          <Accordion
            titulo="Meus documentos"
            aberto={accInicio.estaAberto("meus-documentos")}
            onToggle={() => accInicio.alternar("meus-documentos")}
          >
            <MeusDocumentos colaborador={meuColaborador} equipamentos={meusEquipamentos} onAtualizado={onChanged} />
          </Accordion>

          {/* Meus pagamentos (21/07/2026, pedido do Vini) — histórico
              próprio de salário/adiantamento/férias etc. lançados nas
              folhas, com download do recibo individual quando existir. Só
              documento de apoio (ver reciboSplit.ts no backend) — o valor
              que vale é sempre o do lançamento, não necessariamente igual
              ao do PDF. */}
          <Accordion
            titulo="Meus pagamentos"
            contador={meusPagamentos.length || undefined}
            aberto={accInicio.estaAberto("meus-pagamentos")}
            onToggle={() => accInicio.alternar("meus-pagamentos")}
          >
            {meusPagamentos.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum pagamento lançado ainda.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800 -mx-1">
                {meusPagamentos.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 px-1 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700 dark:text-slate-300 truncate">
                        {TIPO_PAGAMENTO_LABEL[p.tipo]}
                        {p.folha ? (
                          <span className="text-gray-400 dark:text-slate-500"> · {p.folha.competencia}</span>
                        ) : (
                          // Avulso (22/07/2026, pedido do Vini) — pagamento
                          // sem folha (folhaId nulo) sinalizado como tal,
                          // pra não parecer que "sumiu" da competência de
                          // alguma folha regular.
                          <span className="text-gray-400 dark:text-slate-500"> · avulso</span>
                        )}
                        {p.formaPagamento && (
                          <span className="text-gray-400 dark:text-slate-500"> · {FORMA_PAGAMENTO_LABEL[p.formaPagamento]}</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-slate-500" style={{ fontFamily: FONT_MONO }}>
                        {fmtMoney(Number(p.valor))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Stamp tone={STATUS_PAGAMENTO_TONE[p.status]}>{STATUS_PAGAMENTO_LABEL[p.status]}</Stamp>
                      {p.reciboUrl && (
                        <button
                          className="text-brand-600 hover:underline flex items-center gap-1 text-xs"
                          onClick={() => baixarMeuRecibo(p.id, p.folha?.competencia || fmtDate(p.criadoEm ?? "") || "recibo")}
                          aria-label="Baixar recibo"
                        >
                          <Download size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Accordion>

          {/* Listagem unificada "Minhas Solicitações" (Onda 2.4 do
              redesenho, 21/07/2026 — item 9 da auditoria) — antes eram 3
              accordions separados ("Minhas solicitações", "Minhas
              solicitações de papelaria", "Meus chamados"), cada um só com
              seu próprio tipo; agora é 1 accordion só, com os 4 tipos
              juntos numa timeline (mais recente primeiro) e um selo
              colorido (`SELO_TIPO_SOLIC`) indicando qual é qual — mesma
              ideia de "Fila"/"Minhas Solicitações" descrita na seção 2.2 da
              auditoria, aplicada aqui do lado do colaborador (autoatendimento,
              não de quem gerencia). Ganho real, não só estético: Serviço
              nunca tinha aparecido nesta tela antes (ver comentário em
              `minhasServ` acima) — esta unificação também FECHOU essa
              lacuna, não só reorganizou o que já existia. */}
          <div data-tour="portal-meus-chamados">
            <Accordion
              titulo="Minhas solicitações"
              contador={(minhasSolicUnificadas.length + chamadosPendentes.length) || undefined}
              aberto={accInicio.estaAberto("meus-chamados")}
              onToggle={() => accInicio.alternar("meus-chamados")}
            >
              {minhasSolicUnificadas.length === 0 && chamadosPendentes.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500">Nenhuma.</p>
              ) : (
                <ul className="space-y-1.5">
                  {/* Abertura de Chamados Offline (08/07/2026, item 1): chamados
                      ainda na fila local (sem id de verdade, só localId) —
                      aparecem primeiro, sinalizados como pendentes, sem ação de
                      clique (não há detalhe pra abrir até sincronizar). */}
                  {chamadosPendentes.map((p) => (
                    <li
                      key={p.localId}
                      className="text-xs bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-800 rounded-[var(--radius-control)] px-3 py-2.5 flex items-center justify-between gap-2"
                    >
                      <span className="text-amber-900 dark:text-amber-300">{CATEGORIA_CHAMADO_LABEL[p.payload.categoria]}</span>
                      <Stamp tone={p.status === "erro" ? "neg" : "pend"}>{p.status === "erro" ? "Erro ao sincronizar" : "Pendente de Sincronização"}</Stamp>
                    </li>
                  ))}
                  {minhasSolicUnificadas.map((s) => {
                    const selo = SELO_TIPO_SOLIC[s.tipo];
                    const SeloIcon = selo.icon;
                    return (
                      <li
                        key={s.key}
                        onClick={s.onClick}
                        {...(s.onClick ? cardClicavelProps(s.onClick) : {})}
                        className={`text-xs bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] px-3 py-2.5 flex items-center justify-between gap-2 ${s.onClick ? `cursor-pointer hover:border-brand-600/50 ${FOCUS_RING_CLASS}` : ""}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex-shrink-0 ${selo.className}`}>
                            <SeloIcon size={11} /> {selo.label}
                          </span>
                          <span className="text-slate-700 dark:text-slate-300 truncate">{s.titulo}</span>
                        </span>
                        <Stamp tone={s.tone}>{s.status}</Stamp>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Accordion>
          </div>
        </div>
      )}

      {chamadoSelecionadoId && (
        <ChamadoDetalhe
          chamadoId={chamadoSelecionadoId}
          papel="COLABORADOR"
          podeGerenciar={false}
          onClose={() => setChamadoSelecionadoId(null)}
          onChanged={onChanged}
          unidades={unidadesSelecionaveis}
        />
      )}

      {papelariaSelecionadaId && (
        <PortalPapelariaDetalhe
          solicitacaoId={papelariaSelecionadaId}
          onClose={() => setPapelariaSelecionadaId(null)}
        />
      )}

      {/* Ficha da solicitação de Equipamento no Portal (achado de auditoria
          S5, 22/07/2026) — só-leitura, sem timeline (SolicitacaoEquipamento
          não tem uma, diferente de Chamado/Papelaria/Serviço). O objeto já
          vem completo em `data.solicitacoes` (usado em `minhasSolic` acima),
          então não precisa de outra chamada à API só pra abrir a ficha. */}
      {equipamentoSolicSelecionada && (
        <EquipamentoSolicDetalhe
          solicitacao={equipamentoSolicSelecionada}
          onClose={() => setEquipamentoSolicSelecionada(null)}
        />
      )}

      {/* Detalhe de Serviço no Portal (Onda 2.4 do redesenho, 21/07/2026) —
          reaproveita <DetalheServico> de SolicitacoesServico.tsx tal como
          é, sem nenhum componente novo. `ehTI`/`ehFinanceiro` sempre falsos
          aqui (o colaborador comum nunca é nenhum dos dois) fazem o próprio
          componente esconder todos os botões de ação sozinho — vira leitura
          da ficha + linha do tempo, sem risco de expor uma ação que só
          quem gerencia deveria ver. `onAgir` nunca é chamado na prática
          (não há botão que o dispare aqui), mas implementado de verdade —
          não é dead code inofensivo por acaso, é o mesmo contrato que o
          componente exige de qualquer chamador. */}
      {servicoSelecionado && (
        <DetalheServico
          solicitacao={servicoSelecionado}
          ehTI={false}
          ehFinanceiro={false}
          salvando={false}
          onFechar={() => setServicoSelecionado(null)}
          onAgir={async (fn) => {
            await fn();
            recarregarServ();
          }}
        />
      )}

      {escolhendoTipo && (
        <EscolhaTipoSolicitacaoModal
          onEscolher={(tipo) => { setEscolhendoTipo(false); setTela(tipo); }}
          onFechar={() => setEscolhendoTipo(false)}
        />
      )}
    </div>
  );
});

// Nova Solicitação — decisão guiada (Onda 1 do redesenho, 21/07/2026,
// pedido do Vini): "O que você precisa?" com 4 opções ilustradas, cada uma
// com 1 frase de quando usar. Escolher só decide qual `tela` abrir a
// seguir — os 4 formulários por trás continuam exatamente os mesmos de
// sempre (mesma validação, mesmo fluxo de aprovação), porque a auditoria
// encontrou incompatibilidades estruturais reais entre eles (aprovação em
// etapas diferentes, item único vs. múltiplos itens, SLA só em chamado —
// ver Auditoria_Redesign_Portal_Corporativo_21-07-2026.md, seção 0) que
// tornam arriscado fundir isso num formulário/schema único. Unificar aqui
// é só a ENTRADA — o colaborador nunca precisa saber que por baixo são 4
// sistemas diferentes.
function EscolhaTipoSolicitacaoModal({
  onEscolher, onFechar,
}: {
  onEscolher: (tipo: "chamado" | "solicitacao" | "papelaria" | "servico") => void;
  onFechar: () => void;
}) {
  const OPCOES: {
    tipo: "chamado" | "solicitacao" | "papelaria" | "servico";
    icon: React.ComponentType<{ size?: number; className?: string }>;
    titulo: string;
    descricao: string;
  }[] = [
    { tipo: "chamado", icon: Wrench, titulo: "Suporte Técnico", descricao: "Algo parou de funcionar ou está com problema." },
    { tipo: "solicitacao", icon: Laptop, titulo: "Equipamento", descricao: "Preciso de um equipamento que ainda não tenho." },
    { tipo: "papelaria", icon: Package, titulo: "Compra / Papelaria", descricao: "Materiais de escritório ou itens de consumo." },
    { tipo: "servico", icon: Sparkles, titulo: "Serviço", descricao: "Uma ferramenta ou serviço novo pra equipe." },
  ];
  return (
    <Modal title="O que você precisa?" onClose={onFechar}>
      <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2 mb-3.5">
        Escolha uma opção — o formulário certo abre na sequência.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {OPCOES.map((o) => (
          <button
            key={o.tipo}
            onClick={() => onEscolher(o.tipo)}
            className={`text-left border-[1.5px] border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] p-3.5 transition-all duration-[var(--motion-fast)] hover:border-brand-600/50 hover:-translate-y-0.5 ${FOCUS_RING_CLASS}`}
          >
            <o.icon size={19} className="text-brand-600 dark:text-brand-400 mb-1.5" />
            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 mb-0.5">{o.titulo}</p>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-snug">{o.descricao}</p>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function PortalItemLinha({
  icon: Icon, label, vazio, children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  vazio: string;
  children: React.ReactNode;
}) {
  const temConteudo = React.Children.count(children) > 0;
  return (
    <div className="flex gap-3 px-4 py-3">
      <div className="w-9 h-9 rounded-[var(--radius-control)] bg-slate-100 text-slate-600 dark:text-slate-400 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-0.5">{label}</p>
        {temConteudo ? children : <p className="text-xs text-gray-500 dark:text-slate-400 py-1.5">{vazio}</p>}
      </div>
    </div>
  );
}

// "Meus documentos" (21/07/2026, pedido do Vini: "o termo de
// responsabilidade e os demais documentos ficarem tudo no portal do
// colaborador") — junta, num só lugar somente-leitura, o termo de
// responsabilidade do CADASTRO do colaborador (assinado, anexado pelo
// admin — ver TermoResponsabilidade em Colaboradores.tsx) + o termo
// PREENCHIDO na hora por equipamento (gerarTermoPreenchido, já existia pro
// admin) + os anexos/fotos de cada equipamento (AnexosEquipamento,
// reaproveitado com `readOnly`). Nada aqui pode ser enviado/removido pelo
// colaborador — só consultado e baixado.
function MeusDocumentos({
  colaborador,
  equipamentos,
  onAtualizado,
}: {
  colaborador: Colaborador;
  equipamentos: Equipamento[];
  onAtualizado: () => void;
}) {
  const [baixandoTermo, setBaixandoTermo] = useState(false);
  const [baixandoPreenchidoId, setBaixandoPreenchidoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function baixarTermoAssinado() {
    setBaixandoTermo(true);
    setErro(null);
    try {
      const { blob, nomeArquivo } = await colaboradoresApi.baixarTermoResponsabilidade(colaborador.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo || colaborador.termoResponsabilidadeNomeOriginal || "termo-responsabilidade";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível baixar o termo.");
    } finally {
      setBaixandoTermo(false);
    }
  }

  async function baixarTermoPreenchido(equipamentoId: string) {
    setBaixandoPreenchidoId(equipamentoId);
    setErro(null);
    try {
      const { blob, nomeArquivo } = await equipamentosApi.gerarTermoPreenchido(equipamentoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo || "termo-de-responsabilidade.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível gerar o termo.");
    } finally {
      setBaixandoPreenchidoId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1.5">
          Termo de responsabilidade assinado
        </p>
        {colaborador.termoResponsabilidadeUrl ? (
          <Button variant="ghost" onClick={baixarTermoAssinado} disabled={baixandoTermo}>
            {baixandoTermo ? <><Spinner size={14} /> Baixando...</> : <><Download size={15} /> Baixar termo assinado</>}
          </Button>
        ) : (
          <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum termo assinado cadastrado ainda.</p>
        )}
      </div>

      {equipamentos.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum equipamento vinculado ao seu cadastro.</p>
      ) : (
        <div className="space-y-4">
          {equipamentos.map((e) => (
            <div key={e.id} className="border border-gray-100 dark:border-slate-700 rounded-[var(--radius-control)] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                  {e.tipo}
                  {e.modelo ? ` · ${e.modelo}` : ""}
                </p>
                <Button variant="ghost" className="!text-xs !py-1" onClick={() => baixarTermoPreenchido(e.id)} disabled={baixandoPreenchidoId === e.id}>
                  {baixandoPreenchidoId === e.id ? <Spinner size={13} /> : <FileText size={13} />} Termo preenchido
                </Button>
              </div>
              <AnexosEquipamento equipamento={e} onAtualizado={onAtualizado} readOnly />
            </div>
          ))}
        </div>
      )}

      {erro && (
        <p className="text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">
          {erro}
        </p>
      )}
    </div>
  );
}

function PortalChamadoForm({
  onSubmit, onBack, enviando, unidades, tecnicos, unidadeIdPadrao, meusEquipamentos,
}: {
  onSubmit: (form: Omit<ChamadoInput, "solicitanteId">, arquivos: File[]) => void;
  onBack: () => void;
  enviando: boolean;
  unidades: Unidade[];
  tecnicos: Tecnico[];
  unidadeIdPadrao: string | null;
  meusEquipamentos: Equipamento[];
}) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [form, setForm] = useState({
    categoria: CATEGORIAS_CHAMADO_CRIAVEIS[0] as CategoriaChamado,
    // Imoview CRM (09/07/2026) — ver comentário em types.ts.
    tipoSolicitacaoImoview: "" as TipoSolicitacaoImoview | "",
    codigoImovel: "",
    descricao: "",
    // Pré-seleciona a unidade já cadastrada do colaborador (se tiver) — ele
    // continua podendo trocar, por exemplo se o problema é em outra unidade.
    unidadeId: unidadeIdPadrao || "",
    local: "",
    // Equipamento relacionado (07/08/2026, pedido do Vini) — opcional, só
    // entre os equipamentos do próprio colaborador (`meusEquipamentos`,
    // recebido já filtrado do componente pai).
    equipamentoId: "",
    // Achado do Vini (07/07/2026): local e técnico obrigatórios já na
    // abertura. Hoje só existe um técnico (Vinícius) — pré-selecionado
    // automaticamente quando é o único da lista, mas o campo continua
    // visível e obrigatório (não escondido), preparado pra quando houver
    // mais gente no Suporte de TI.
    responsavelId: tecnicos.length === 1 ? tecnicos[0].id : "",
    prioridade: "MEDIA" as Prioridade,
  });
  // Achado de auditoria (06/07/2026): antes, o botão só ficava desabilitado
  // quando faltava preencher "Descreva o problema" — sem nenhuma explicação
  // na tela. Quem não reparasse (fácil no celular) ficava clicando um botão
  // que não reage, sem entender por quê. Agora o botão sempre reage: se
  // faltar campo obrigatório, mostra a mensagem embaixo do campo em vez de
  // só desabilitar silenciosamente.
  const [tentouEnviar, setTentouEnviar] = useState(false);

  // Se a lista de técnicos chegar depois da primeira renderização (é buscada
  // assíncrona no componente pai) e só tiver uma opção, pré-seleciona assim
  // que ela chegar — sem isso, quem abre a tela rápido via primeira opção
  // vazia.
  useEffect(() => {
    if (tecnicos.length === 1 && !form.responsavelId) {
      setForm((f) => ({ ...f, responsavelId: tecnicos[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tecnicos]);

  const descricaoValida = form.descricao.trim().length > 0;
  const unidadeValida = form.unidadeId.length > 0;
  const tecnicoValido = form.responsavelId.length > 0;
  const ehImoview = form.categoria === "IMOVIEW_CRM";
  const precisaCodigoImovel = ehImoview && form.tipoSolicitacaoImoview === "PROBLEMA_IMOVEL";
  const tipoImoviewValido = !ehImoview || !!form.tipoSolicitacaoImoview;
  const codigoImovelValido = !precisaCodigoImovel || form.codigoImovel.trim().length > 0;

  function tentarEnviar() {
    if (!descricaoValida || !unidadeValida || !tecnicoValido || !tipoImoviewValido || !codigoImovelValido) {
      setTentouEnviar(true);
      return;
    }
    onSubmit(
      {
        ...form,
        tipoSolicitacaoImoview: ehImoview && form.tipoSolicitacaoImoview ? form.tipoSolicitacaoImoview : null,
        codigoImovel: precisaCodigoImovel && form.codigoImovel ? form.codigoImovel : null,
        local: form.local || null,
        equipamentoId: form.equipamentoId || null,
      },
      arquivos
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-5 mb-7" style={{ boxShadow: CARD_SHADOW }}>
      <Field label="Categoria">
        <Select
          value={form.categoria}
          onChange={(e) => {
            const categoria = e.target.value as CategoriaChamado;
            setForm({ ...form, categoria, tipoSolicitacaoImoview: "", codigoImovel: "" });
          }}
        >
          {CATEGORIAS_CHAMADO_CRIAVEIS.map((c) => <option key={c} value={c}>{CATEGORIA_CHAMADO_LABEL[c]}</option>)}
        </Select>
      </Field>
      {ehImoview && (
        <Field label="Tipo da solicitação">
          <Select
            value={form.tipoSolicitacaoImoview}
            onChange={(e) => setForm({ ...form, tipoSolicitacaoImoview: e.target.value as TipoSolicitacaoImoview, codigoImovel: "" })}
            className={tentouEnviar && !tipoImoviewValido ? "border-red-400 focus:border-red-400" : undefined}
          >
            <option value="">Selecione o tipo...</option>
            {TIPOS_SOLICITACAO_IMOVIEW.map((t) => <option key={t} value={t}>{TIPO_SOLICITACAO_IMOVIEW_LABEL[t]}</option>)}
          </Select>
          {tentouEnviar && !tipoImoviewValido && (
            <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Escolha o tipo da solicitação antes de enviar — este campo é obrigatório.</p>
          )}
        </Field>
      )}
      {precisaCodigoImovel && (
        <Field label="Código do imóvel">
          <TextInput
            value={form.codigoImovel}
            onChange={(e) => setForm({ ...form, codigoImovel: e.target.value })}
            placeholder="Ex: IT-0123"
            className={tentouEnviar && !codigoImovelValido ? "border-red-400 focus:border-red-400" : undefined}
          />
          {tentouEnviar && !codigoImovelValido && (
            <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Informe o código do imóvel antes de enviar — este campo é obrigatório.</p>
          )}
        </Field>
      )}
      <Field label="Descreva o problema">
        <TextArea
          value={form.descricao}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          className={tentouEnviar && !descricaoValida ? "border-red-400 focus:border-red-400" : undefined}
        />
        {tentouEnviar && !descricaoValida && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Descreva o problema antes de enviar — este campo é obrigatório.</p>
        )}
      </Field>
      <Field label="Unidade">
        <Select
          value={form.unidadeId}
          onChange={(e) => setForm({ ...form, unidadeId: e.target.value })}
          className={tentouEnviar && !unidadeValida ? "border-red-400 focus:border-red-400" : undefined}
        >
          <option value="">Selecione a unidade...</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        {tentouEnviar && !unidadeValida && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Escolha a unidade antes de enviar — este campo é obrigatório.</p>
        )}
      </Field>
      <Field label="Detalhe do local (opcional)">
        <TextInput value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} placeholder="Ex: Sala TI, Recepção" />
      </Field>
      {/* Equipamento relacionado (07/08/2026, pedido do Vini) — opcional,
          só entre os equipamentos vinculados a este colaborador. Mensagem
          clara em vez do campo quando ele não tem nenhum, em vez de mostrar
          um seletor vazio sem explicação. */}
      {meusEquipamentos.length > 0 ? (
        <Field label="Equipamento relacionado (opcional)">
          <Select value={form.equipamentoId} onChange={(e) => setForm({ ...form, equipamentoId: e.target.value })}>
            <option value="">—</option>
            {meusEquipamentos.map((eq) => <option key={eq.id} value={eq.id}>{rotuloEquipamento(eq)}</option>)}
          </Select>
        </Field>
      ) : (
        <Field label="Equipamento relacionado">
          <p className="text-xs text-gray-500 dark:text-slate-400">Nenhum equipamento vinculado ao seu cadastro.</p>
        </Field>
      )}
      <Field label="Técnico responsável">
        <Select
          value={form.responsavelId}
          onChange={(e) => setForm({ ...form, responsavelId: e.target.value })}
          className={tentouEnviar && !tecnicoValido ? "border-red-400 focus:border-red-400" : undefined}
        >
          <option value="">Selecione o técnico...</option>
          {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </Select>
        {tentouEnviar && !tecnicoValido && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Escolha o técnico responsável antes de enviar — este campo é obrigatório.</p>
        )}
      </Field>
      <Field label="Prioridade">
        <Select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Prioridade })}>
          <option value="ALTA">Alta</option>
          <option value="MEDIA">Média</option>
          <option value="BAIXA">Baixa</option>
        </Select>
      </Field>
      <SeletorAnexos arquivos={arquivos} onChange={setArquivos} />
      <div className="flex justify-between gap-2 mt-4">
        <Button variant="ghost" onClick={onBack}>Voltar</Button>
        <Button variant="primary" onClick={tentarEnviar} disabled={enviando}>
          {enviando ? "Enviando..." : "Enviar Chamado"}
        </Button>
      </div>
    </div>
  );
}

// Chave-sentinela pra "item fora do catálogo" no formulário de Solicitação
// de Equipamentos do Portal — mesmo racional de CHAVE_ITEM_AVULSO (papelaria,
// logo abaixo), só que num nome próprio pra não confundir os dois catálogos
// (Equipamento e Papelaria são módulos independentes desde 09/07/2026, ver
// comentário em Solicitacoes.tsx).
const CHAVE_ITEM_AVULSO_EQUIPAMENTO = "__avulso_equipamento__";

function PortalSolicitacaoForm({
  onSubmit, onBack, enviando, unidades, tecnicos, categorias, produtos, unidadeIdPadrao,
}: {
  onSubmit: (form: Omit<SolicitacaoInput, "solicitanteId">) => void;
  onBack: () => void;
  enviando: boolean;
  unidades: Unidade[];
  tecnicos: Tecnico[];
  categorias: AppData["dominios"]["categoriasProdutoEquipamento"];
  produtos: AppData["dominios"]["produtosEquipamento"];
  unidadeIdPadrao: string | null;
}) {
  const [form, setForm] = useState({
    produtoId: "",
    categoriaId: "",
    item: "",
    justificativa: "",
    prioridade: "MEDIA" as Prioridade,
    quantidade: 1,
    valorUnitario: 0,
    unidadeId: unidadeIdPadrao || "",
    tecnicoResponsavelId: tecnicos.length === 1 ? tecnicos[0].id : "",
  });
  // Mesmo achado de auditoria (06/07/2026) do formulário de chamado: botão
  // sempre reage a clique; falta de campo obrigatório vira mensagem visível
  // embaixo do campo, não um botão desabilitado sem explicação.
  const [tentouEnviar, setTentouEnviar] = useState(false);

  // Mesma lógica do formulário de chamado: pré-seleciona o único técnico
  // assim que a lista chegar, caso a tela já tenha renderizado antes disso.
  useEffect(() => {
    if (tecnicos.length === 1 && !form.tecnicoResponsavelId) {
      setForm((f) => ({ ...f, tecnicoResponsavelId: tecnicos[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tecnicos]);

  // Catálogo agrupado por categoria pra virar <optgroup> — mesmo padrão já
  // usado no formulário de Papelaria logo abaixo neste arquivo.
  const categoriasAtivas = categorias.filter((c) => c.status === "ATIVO");
  const produtosAtivos = produtos.filter((p) => p.status === "ATIVO");
  const produtosPorCategoria = categoriasAtivas
    .map((cat) => ({ categoria: cat, produtos: produtosAtivos.filter((p) => p.categoriaId === cat.id) }))
    .filter((grupo) => grupo.produtos.length > 0);
  const itemAvulso = form.produtoId === CHAVE_ITEM_AVULSO_EQUIPAMENTO;

  function escolherProduto(produtoId: string) {
    if (produtoId === CHAVE_ITEM_AVULSO_EQUIPAMENTO) {
      setForm({ ...form, produtoId, categoriaId: "", item: "" });
      return;
    }
    const produto = produtosAtivos.find((p) => p.id === produtoId);
    setForm({ ...form, produtoId, categoriaId: produto?.categoriaId || "", item: produto?.nome || "" });
  }

  const itemValido = itemAvulso ? form.item.trim().length > 0 && form.categoriaId.length > 0 : form.produtoId.length > 0;
  const unidadeValida = form.unidadeId.length > 0;
  const tecnicoValido = form.tecnicoResponsavelId.length > 0;

  function tentarEnviar() {
    if (!itemValido || !unidadeValida || !tecnicoValido) {
      setTentouEnviar(true);
      return;
    }
    onSubmit({
      ...form,
      produtoId: itemAvulso ? undefined : form.produtoId || undefined,
      categoriaId: form.categoriaId || undefined,
    });
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-5 mb-7" style={{ boxShadow: CARD_SHADOW }}>
      <Field label="Item Solicitado">
        <Select
          value={form.produtoId}
          onChange={(e) => escolherProduto(e.target.value)}
          className={tentouEnviar && !itemValido ? "border-red-400 focus:border-red-400" : undefined}
        >
          <option value="">Selecione um item...</option>
          <option value={CHAVE_ITEM_AVULSO_EQUIPAMENTO}>Outro (não está na lista)</option>
          {produtosPorCategoria.map((grupo) => (
            <optgroup key={grupo.categoria.id} label={grupo.categoria.nome}>
              {grupo.produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </optgroup>
          ))}
        </Select>
        {itemAvulso && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <TextInput
              value={form.item}
              onChange={(e) => setForm({ ...form, item: e.target.value })}
              placeholder="Nome do item"
              className={tentouEnviar && !form.item.trim() ? "border-red-400 focus:border-red-400" : undefined}
            />
            <Select
              value={form.categoriaId}
              onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}
              className={tentouEnviar && !form.categoriaId ? "border-red-400 focus:border-red-400" : undefined}
            >
              <option value="">Categoria...</option>
              {categoriasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </div>
        )}
        {tentouEnviar && !itemValido && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">
            {itemAvulso ? "Informe o nome e a categoria do item." : "Escolha um item do catálogo (ou \"Outro\") antes de enviar."}
          </p>
        )}
      </Field>
      <Field label="Justificativa">
        <TextArea value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} />
      </Field>
      <Field label="Unidade">
        <Select
          value={form.unidadeId}
          onChange={(e) => setForm({ ...form, unidadeId: e.target.value })}
          className={tentouEnviar && !unidadeValida ? "border-red-400 focus:border-red-400" : undefined}
        >
          <option value="">Selecione a unidade...</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        {tentouEnviar && !unidadeValida && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Escolha a unidade antes de enviar — este campo é obrigatório.</p>
        )}
      </Field>
      <Field label="Técnico responsável">
        <Select
          value={form.tecnicoResponsavelId}
          onChange={(e) => setForm({ ...form, tecnicoResponsavelId: e.target.value })}
          className={tentouEnviar && !tecnicoValido ? "border-red-400 focus:border-red-400" : undefined}
        >
          <option value="">Selecione o técnico...</option>
          {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </Select>
        {tentouEnviar && !tecnicoValido && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Escolha o técnico responsável antes de enviar — este campo é obrigatório.</p>
        )}
      </Field>
      <Field label="Prioridade">
        <Select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Prioridade })}>
          <option value="ALTA">Alta</option>
          <option value="MEDIA">Média</option>
          <option value="BAIXA">Baixa</option>
        </Select>
      </Field>
      <div className="flex justify-between gap-2 mt-4">
        <Button variant="ghost" onClick={onBack}>Voltar</Button>
        <Button variant="primary" onClick={tentarEnviar} disabled={enviando}>
          {enviando ? "Enviando..." : "Enviar Solicitação"}
        </Button>
      </div>
    </div>
  );
}

// Formulário "Solicitar Papelaria" (09/07/2026, correção de fluxo pedida
// pelo Vini) — deliberadamente SEM campo de tipo (Mensal/Avulsa) nem
// prioridade: o colaborador só descreve o que precisa (unidade + itens do
// catálogo, ou item avulso fora do catálogo + observação livre); quem
// classifica se é urgente e reclassifica Mensal/Avulsa é o RH, na tela de
// gestão do módulo (SolicitacoesPapelaria.tsx), antes de aprovar — ver
// comentário no topo de solicitacoesPapelaria.routes.ts (backend) para o
// racional completo da divisão de responsabilidade.
const CHAVE_ITEM_AVULSO = "__avulso__";

interface ItemFormPapelaria {
  chave: string;
  produtoId: string; // "" = nada escolhido ainda; CHAVE_ITEM_AVULSO = item fora do catálogo
  categoriaId: string; // sempre precisa de um valor — auto-preenchido quando produtoId é de catálogo
  nomeProduto: string; // só usado (e obrigatório) quando produtoId === CHAVE_ITEM_AVULSO
  quantidade: number;
}

function novoItemPapelaria(): ItemFormPapelaria {
  return { chave: `item-${Math.random().toString(36).slice(2)}`, produtoId: "", categoriaId: "", nomeProduto: "", quantidade: 1 };
}

function PortalPapelariaForm({
  onSubmit, onBack, enviando, unidades, produtos, categorias, unidadeIdPadrao,
}: {
  onSubmit: (form: { unidadeId: string; observacoes: string; itens: ItemSolicitacaoPapelariaInput[] }) => void;
  onBack: () => void;
  enviando: boolean;
  unidades: Unidade[];
  produtos: AppData["dominios"]["produtosPapelaria"];
  categorias: AppData["dominios"]["categoriasProdutoPapelaria"];
  unidadeIdPadrao: string | null;
}) {
  const [unidadeId, setUnidadeId] = useState(unidadeIdPadrao || "");
  const [observacoes, setObservacoes] = useState("");
  const [itens, setItens] = useState<ItemFormPapelaria[]>([novoItemPapelaria()]);
  // Mesmo achado de auditoria (06/07/2026) dos outros formulários do Portal:
  // botão sempre reage a clique; falta de campo obrigatório vira mensagem
  // visível embaixo do campo, não um botão desabilitado sem explicação.
  const [tentouEnviar, setTentouEnviar] = useState(false);

  const produtosAtivos = produtos.filter((p) => p.status === "ATIVO");
  const categoriasAtivas = categorias.filter((c) => c.status === "ATIVO");
  // Agrupa o catálogo por categoria pra virar <optgroup> no seletor — muito
  // mais fácil de navegar do que uma lista plana de ~90 produtos.
  const produtosPorCategoria = categoriasAtivas
    .map((cat) => ({ categoria: cat, produtos: produtosAtivos.filter((p) => p.categoriaId === cat.id) }))
    .filter((grupo) => grupo.produtos.length > 0);

  function atualizarItem(chave: string, alteracoes: Partial<ItemFormPapelaria>) {
    setItens((atual) => atual.map((it) => (it.chave === chave ? { ...it, ...alteracoes } : it)));
  }

  function escolherProduto(chave: string, produtoId: string) {
    if (produtoId === CHAVE_ITEM_AVULSO) {
      atualizarItem(chave, { produtoId, categoriaId: "", nomeProduto: "" });
      return;
    }
    const produto = produtosAtivos.find((p) => p.id === produtoId);
    atualizarItem(chave, { produtoId, categoriaId: produto?.categoriaId || "", nomeProduto: "" });
  }

  function adicionarItem() {
    setItens((atual) => [...atual, novoItemPapelaria()]);
  }

  function removerItem(chave: string) {
    setItens((atual) => (atual.length === 1 ? atual : atual.filter((it) => it.chave !== chave)));
  }

  const unidadeValida = unidadeId.length > 0;
  function itemValido(it: ItemFormPapelaria): boolean {
    if (it.quantidade < 1) return false;
    if (it.produtoId === CHAVE_ITEM_AVULSO) return it.nomeProduto.trim().length > 0 && it.categoriaId.length > 0;
    return it.produtoId.length > 0 && it.categoriaId.length > 0;
  }
  const itensValidos = itens.length > 0 && itens.every(itemValido);

  function tentarEnviar() {
    if (!unidadeValida || !itensValidos) {
      setTentouEnviar(true);
      return;
    }
    const itensPayload: ItemSolicitacaoPapelariaInput[] = itens.map((it) =>
      it.produtoId === CHAVE_ITEM_AVULSO
        ? { nomeProduto: it.nomeProduto.trim(), categoriaId: it.categoriaId, quantidade: it.quantidade }
        : { produtoId: it.produtoId, categoriaId: it.categoriaId, quantidade: it.quantidade }
    );
    onSubmit({ unidadeId, observacoes, itens: itensPayload });
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-5 mb-7" style={{ boxShadow: CARD_SHADOW }}>
      <Field label="Unidade">
        <Select
          value={unidadeId}
          onChange={(e) => setUnidadeId(e.target.value)}
          className={tentouEnviar && !unidadeValida ? "border-red-400 focus:border-red-400" : undefined}
        >
          <option value="">Selecione a unidade...</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
        {tentouEnviar && !unidadeValida && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Escolha a unidade antes de enviar — este campo é obrigatório.</p>
        )}
      </Field>

      <div className="mb-1">
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-2">Itens solicitados</p>
        <div className="space-y-3">
          {itens.map((it) => {
            const invalido = tentouEnviar && !itemValido(it);
            return (
              <div key={it.chave} className="border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <Select
                      value={it.produtoId}
                      onChange={(e) => escolherProduto(it.chave, e.target.value)}
                      className={invalido && !it.produtoId ? "border-red-400 focus:border-red-400" : undefined}
                    >
                      <option value="">Selecione um produto...</option>
                      <option value={CHAVE_ITEM_AVULSO}>Outro (não está na lista)</option>
                      {produtosPorCategoria.map((grupo) => (
                        <optgroup key={grupo.categoria.id} label={grupo.categoria.nome}>
                          {grupo.produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                        </optgroup>
                      ))}
                    </Select>
                  </div>
                  {itens.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removerItem(it.chave)}
                      className="text-gray-400 dark:text-slate-500 hover:text-brand-600 p-2 flex-shrink-0"
                      title="Remover item"
                      aria-label="Remover item"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {it.produtoId === CHAVE_ITEM_AVULSO && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <TextInput
                        value={it.nomeProduto}
                        onChange={(e) => atualizarItem(it.chave, { nomeProduto: e.target.value })}
                        placeholder="Nome do item"
                        className={invalido && !it.nomeProduto.trim() ? "border-red-400 focus:border-red-400" : undefined}
                      />
                    </div>
                    <div>
                      <Select
                        value={it.categoriaId}
                        onChange={(e) => atualizarItem(it.chave, { categoriaId: e.target.value })}
                        className={invalido && !it.categoriaId ? "border-red-400 focus:border-red-400" : undefined}
                      >
                        <option value="">Categoria...</option>
                        {categoriasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </Select>
                    </div>
                  </div>
                )}

                <div className="mt-2 w-24">
                  <TextInput
                    type="number"
                    min={1}
                    value={it.quantidade}
                    onChange={(e) => atualizarItem(it.chave, { quantidade: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>

                {invalido && (
                  <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">
                    {it.produtoId === CHAVE_ITEM_AVULSO
                      ? "Informe o nome e a categoria do item, com quantidade válida."
                      : "Escolha um produto do catálogo (ou \"Outro\"), com quantidade válida."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <Button variant="ghost" className="mt-2 text-xs" onClick={adicionarItem}>
          + Adicionar item
        </Button>
      </div>

      <Field label="Observação (opcional)">
        <TextArea
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Algum detalhe adicional sobre o pedido..."
        />
      </Field>

      <div className="flex justify-between gap-2 mt-4">
        <Button variant="ghost" onClick={onBack}>Voltar</Button>
        <Button variant="primary" onClick={tentarEnviar} disabled={enviando}>
          {enviando ? "Enviando..." : "Enviar Solicitação"}
        </Button>
      </div>
    </div>
  );
}

// Descrição de cada tipo de evento na linha do tempo do detalhe (abaixo) —
// mesmo racional de DESCRICAO_EVENTO em ChamadoDetalhe.tsx, só que para os
// tipos de EventoSolicitacaoPapelaria (CRIACAO/EDICAO/MUDANCA_STATUS —
// COMENTARIO é tratado à parte, como bolha de chat, não como linha de
// histórico).
const DESCRICAO_EVENTO_PAPELARIA: Record<string, (detalhe: Record<string, unknown> | null) => string> = {
  CRIACAO: () => "Solicitação criada",
  EDICAO: (d) => `Dados atualizados${d?.camposAlterados ? ` (${(d.camposAlterados as string[]).join(", ")})` : ""}`,
  MUDANCA_STATUS: (d) =>
    `Status alterado: ${STATUS_SOLICITACAO_PAPELARIA_LABEL[d?.de as StatusSolicitacaoPapelaria] || d?.de} → ${STATUS_SOLICITACAO_PAPELARIA_LABEL[d?.para as StatusSolicitacaoPapelaria] || d?.para}${d?.motivo ? ` — ${d.motivo}` : ""}`,
};

// Ficha da PRÓPRIA solicitação de Equipamento, aberta ao clicar num item
// "Equipamento" em "Minhas solicitações" (achado de auditoria S5,
// 22/07/2026). Só-leitura e sem timeline — diferente de Chamado/Papelaria/
// Serviço, SolicitacaoEquipamento não tem uma tabela de eventos própria (ver
// comentário em solicitacoes.routes.ts); o motivo de uma eventual
// reprovação, quando existir, fica em `observacoes` (mesmo campo mostrado
// aqui). Valor/fornecedor da compra ficam de fora de propósito — mesma regra
// já aplicada no resto do Portal: quem pediu não vê preço, só quem cuida da
// compra (ver SolicitacaoForm em Solicitacoes.tsx).
function EquipamentoSolicDetalhe({ solicitacao: s, onClose }: { solicitacao: SolicitacaoEquipamento; onClose: () => void }) {
  return (
    <Modal title={`#${s.numero} — ${s.item}`} onClose={onClose}>
      <div className="space-y-2 text-sm">
        {s.categoria?.nome && (
          <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Categoria</span><br />{s.categoria.nome}</div>
        )}
        {s.justificativa && (
          <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Justificativa</span><br />{s.justificativa}</div>
        )}
        <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Unidade</span><br />{s.unidade?.nome || "—"}</div>
        <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Quantidade</span><br />{s.quantidade}</div>
        <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Status</span><br /><Stamp tone={STATUS_SOLICITACAO_TONE[s.status]}>{STATUS_SOLICITACAO_LABEL[s.status]}</Stamp></div>
        {s.status === "REPROVADO" && s.observacoes && (
          <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Motivo da reprovação</span><br />{s.observacoes}</div>
        )}
        <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Solicitada em</span><br />{fmtDataHora(s.dataSolicitacao)}</div>
      </div>
      <div className="flex justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}

// Painel de detalhe da PRÓPRIA solicitação de Papelaria e Compras, aberto ao
// clicar num item de "Minhas solicitações de papelaria" — versão só-leitura
// mais chat (sem controles de status/tipo/prioridade, que só quem gerencia
// tem, ver SolicitacoesPapelaria.tsx no Sistema Administrativo), mesmo
// racional de ChamadoDetalhe.tsx com podeGerenciar=false.
function PortalPapelariaDetalhe({ solicitacaoId, onClose }: { solicitacaoId: string; onClose: () => void }) {
  const [solicitacao, setSolicitacao] = useState<SolicitacaoPapelaria | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const s = await solicitacoesPapelariaApi.getOne(solicitacaoId);
      setSolicitacao(s);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar a solicitação.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitacaoId]);

  async function enviarMensagem() {
    if (!mensagem.trim()) return;
    setEnviando(true);
    setErro(null);
    try {
      await solicitacoesPapelariaApi.comentar(solicitacaoId, mensagem.trim());
      setMensagem("");
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar a mensagem.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando || !solicitacao) {
    return (
      <Modal title="Solicitação de Papelaria" onClose={onClose}>
        <LoadingState />
      </Modal>
    );
  }

  return (
    <Modal title={`Solicitação de Papelaria #${solicitacao.numero}`} onClose={onClose} wide>
      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erro}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2 text-sm mb-3">
          <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Unidade</span><br />{solicitacao.unidade?.nome || "—"}</div>
          <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Tipo</span><br /><Stamp>{TIPO_SOLICITACAO_PAPELARIA_LABEL[solicitacao.tipo]}</Stamp></div>
          <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Status</span><br /><Stamp tone={STATUS_SOLICITACAO_PAPELARIA_TONE[solicitacao.status]}>{STATUS_SOLICITACAO_PAPELARIA_LABEL[solicitacao.status]}</Stamp></div>
          {solicitacao.observacoes && (
            <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Observação</span><br />{solicitacao.observacoes}</div>
          )}
          <div>
            <span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Itens</span>
            <ul className="mt-1 space-y-1">
              {(solicitacao.itens || []).map((it) => (
                <li key={it.id} className="text-slate-700 dark:text-slate-300">
                  {it.quantidade}x {it.nomeProduto}{" "}
                  <span className="text-gray-400 dark:text-slate-500">({UNIDADE_MEDIDA_PRODUTO_LABEL[it.unidadeMedida]})</span>
                </li>
              ))}
            </ul>
          </div>
          <div><span className="text-gray-500 dark:text-slate-400 text-xs uppercase">Solicitada em</span><br />{fmtDataHora(solicitacao.dataSolicitacao)}</div>
        </div>

        <div className="flex flex-col border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] overflow-hidden" style={{ maxHeight: 420 }}>
          <div className="px-3 py-2 bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 text-xs font-bold uppercase text-gray-500 dark:text-slate-400">
            Histórico e conversa
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {(solicitacao.eventos || []).map((ev) =>
              ev.tipo === "COMENTARIO" ? (
                <div key={ev.id} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-[var(--radius-control)] p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate min-w-0">
                      {ev.autor?.colaborador?.nomeCompleto || ev.autor?.email || "—"}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500 flex-shrink-0">{fmtDataHora(ev.criadoEm)}</span>
                  </div>
                  <p className="text-slate-800 mt-0.5">{ev.mensagem}</p>
                </div>
              ) : (
                <div key={ev.id} className="text-[11px] text-gray-400 dark:text-slate-500 italic px-1">
                  {DESCRICAO_EVENTO_PAPELARIA[ev.tipo]?.(ev.detalhe) || ev.tipo} · {fmtDataHora(ev.criadoEm)}
                </div>
              )
            )}
            {(solicitacao.eventos || []).length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-6">Sem histórico ainda.</p>}
          </div>
          <div className="p-2 border-t border-gray-200 dark:border-slate-700 flex gap-2">
            <TextInput
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Escrever mensagem..."
              onKeyDown={(e) => { if (e.key === "Enter") enviarMensagem(); }}
            />
            <Button variant="primary" onClick={enviarMensagem} disabled={!mensagem.trim() || enviando}>
              <Send size={14} />
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}


// Formulário "Solicitar Serviço" do Portal (20/07/2026, pedido do Vini) —
// autocontido: envia direto pela API e mostra confirmação, sem depender do
// fluxo de `enviado` compartilhado do Portal (mantém o componente pequeno).
function PortalServicoForm({
  solicitanteId, unidadeIdPadrao, unidades, onBack, onEnviado,
}: {
  solicitanteId: string;
  unidadeIdPadrao: string | null;
  unidades: { id: string; nome: string }[];
  onBack: () => void;
  onEnviado: () => void;
}) {
  const { sucesso } = useFeedback();
  const [servico, setServico] = useState("");
  const [descricao, setDescricao] = useState("");
  const [unidadeId, setUnidadeId] = useState(unidadeIdPadrao || "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Achado de auditoria S4 (22/07/2026): os outros 3 formulários do Portal
  // (Chamado, Equipamento, Papelaria — ver PortalChamadoForm/
  // PortalSolicitacaoForm/PortalPapelariaForm acima) já usam este padrão
  // (`tentouEnviar`) desde 06/07/2026; Serviço é o mais novo dos 4
  // (20/07/2026) e ainda não tinha recebido a correção. Mesmo racional:
  // botão sempre reage a clique, falta de campo obrigatório vira mensagem
  // visível embaixo do campo em vez de só desabilitar silenciosamente.
  const [tentouEnviar, setTentouEnviar] = useState(false);

  const servicoValido = servico.trim().length >= 2;

  function tentarEnviar() {
    if (!servicoValido) {
      setTentouEnviar(true);
      return;
    }
    enviar();
  }

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      await solicitacoesServicoApi.create({
        solicitanteId,
        servico: servico.trim(),
        descricao: descricao || null,
        unidadeId: unidadeId || null,
      });
      sucesso("Solicitação de serviço enviada — o Suporte TI foi avisado.");
      onEnviado();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mb-7">
      <Button variant="ghost" className="mb-3" onClick={onBack}>Voltar</Button>
      <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-1">Solicitar Serviço</h3>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
        Precisa de alguma ferramenta ou serviço pro seu trabalho (ex: Dropbox, um software, uma assinatura)?
        O Suporte TI resolve o acesso — e, se precisar de plano pago, o Financeiro cuida da contratação.
      </p>
      {erro && <div className="mb-3 text-xs bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
      <Field label="Qual serviço você precisa?">
        <TextInput
          value={servico}
          onChange={(e) => setServico(e.target.value)}
          placeholder="Ex: Dropbox para o setor de marketing"
          className={tentouEnviar && !servicoValido ? "border-red-400 focus:border-red-400" : undefined}
        />
        {tentouEnviar && !servicoValido && (
          <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">Diga qual serviço você precisa antes de enviar — este campo é obrigatório.</p>
        )}
      </Field>
      <Field label="Descreva a necessidade (opcional)">
        <TextArea value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </Field>
      {/* Achado de auditoria S13 (22/07/2026): Unidade é o único campo deste
          formulário que já é opcional no backend (ver solicitacoesServico.
          routes.ts — `unidadeId: z.string().optional().nullable()`) mas não
          dizia isso no rótulo, diferente de "Descreva a necessidade" acima. */}
      <Field label="Unidade (opcional)">
        <Select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
          <option value="">—</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
      </Field>
      <Button variant="primary" className="w-full justify-center mt-2" disabled={enviando} onClick={tentarEnviar}>
        {enviando ? "Enviando..." : <><Send size={15} /> Enviar solicitação</>}
      </Button>
    </div>
  );
}
