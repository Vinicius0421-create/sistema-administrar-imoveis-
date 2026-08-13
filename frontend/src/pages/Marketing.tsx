import React, { useCallback, useEffect, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { marketingApi, ImovelMarketingInput } from "../api/marketing";
import { ApiError } from "../lib/apiClient";
import { parseValorMonetario } from "../lib/mascaras";
import {
  Button, EmptyState, Field, fmtDataHora, fmtMoney, Modal, PageHeader, Paginacao, Select, SearchBox,
  Spinner, Stamp, TextArea, TextInput,
} from "../components/ui";
import { Building2, Camera, Plus, Repeat, Video } from "../components/icons";
import {
  ImovelMarketing, Papel, PRIORIDADE_IMOVEL_LABEL, PrioridadeImovel, STATUS_IMOVEL_LABEL, STATUS_IMOVEL_TONE,
  StatusImovel, StatusSincronizacaoImoview, TIPO_IMOVEL_LABEL, TipoImovel,
} from "../types";
import { useFeedback } from "../contexts/FeedbackContext";

// Marketing Imobiliário — Banco de Imóveis (13/08/2026, Fases 1+2+8). Única
// tela de verdade do módulo hoje: sem dashboard próprio (isso é a Fase 5 do
// roadmap original do módulo, fora de escopo aqui) — um "Visão Geral"
// separado seria uma tela vazia, então não existe item de NAV pra isso (ver
// App.tsx). ImovelMarketing não referencia nenhum dos 4 domínios
// extensíveis (Canal/Objetivo/Origem de Lead/Tipo de Criativo) ainda — eles
// existem no backend (marketing.routes.ts) e em marketingApi para as
// próximas fases (campanhas), mas não têm tela própria aqui por não
// existir, hoje, nenhum lugar que os utilize.

interface Props {
  data: AppData;
  papel: Papel;
  onChanged?: () => void;
}

const PAPEIS_EDITAM = new Set<Papel>(["ADMINISTRADOR", "MARKETING"]);

function corretorLabel(imovel: ImovelMarketing): string {
  if (imovel.corretor?.nomeCompleto) return imovel.corretor.nomeCompleto;
  if (imovel.corretorNome) return imovel.corretorNome;
  return "—";
}

export function MarketingPage({ data, papel, onChanged }: Props) {
  const { sucesso } = useFeedback();
  const podeEditar = PAPEIS_EDITAM.has(papel);

  const [imoveis, setImoveis] = useState<ImovelMarketing[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroUnidade, setFiltroUnidade] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoImovel | "">("");
  const [filtroStatus, setFiltroStatus] = useState<StatusImovel | "">("");
  const [filtroPrioridade, setFiltroPrioridade] = useState<PrioridadeImovel | "">("");

  const [imovelAberto, setImovelAberto] = useState<ImovelMarketing | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [statusSync, setStatusSync] = useState<StatusSincronizacaoImoview | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await marketingApi.listarImoveis({
        page: pagina,
        pageSize: 20,
        unidadeId: filtroUnidade || undefined,
        tipo: filtroTipo || undefined,
        status: filtroStatus || undefined,
        prioridade: filtroPrioridade || undefined,
        busca: busca || undefined,
      });
      setImoveis(resposta.items);
      setMeta(resposta.meta);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os imóveis.");
    } finally {
      setCarregando(false);
    }
  }, [pagina, filtroUnidade, filtroTipo, filtroStatus, filtroPrioridade, busca]);

  useEffect(() => { carregar(); }, [carregar]);

  // Qualquer mudança de filtro volta pra página 1 — evita ficar "preso" numa
  // página que não existe mais no novo recorte (mesmo racional do
  // usePaginacaoCliente do resto do sistema, aqui feito à mão porque a
  // paginação é do servidor).
  useEffect(() => { setPagina(1); }, [filtroUnidade, filtroTipo, filtroStatus, filtroPrioridade, busca]);

  const carregarStatusSync = useCallback(() => {
    marketingApi.statusSincronizacao().then(setStatusSync).catch(() => {});
  }, []);
  useEffect(() => { carregarStatusSync(); }, [carregarStatusSync]);

  async function executarSincronizacao() {
    setSincronizando(true);
    try {
      const resultado = await marketingApi.executarSincronizacao();
      if (resultado.sucesso) {
        sucesso(`Sincronização concluída: ${resultado.quantidade} imóvel(is) processado(s).`);
      } else {
        setErro(resultado.erro || "Falha na sincronização com o Imoview.");
      }
      carregarStatusSync();
      carregar();
      onChanged?.();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível executar a sincronização.");
    } finally {
      setSincronizando(false);
    }
  }

  async function salvar(dados: ImovelMarketingInput, idEdicao: string | null) {
    setSalvando(true);
    setErro(null);
    try {
      if (idEdicao) {
        await marketingApi.atualizarImovel(idEdicao, dados);
        sucesso("Imóvel atualizado.");
      } else {
        await marketingApi.criarImovel(dados);
        sucesso("Imóvel cadastrado.");
      }
      setImovelAberto(null);
      setNovoAberto(false);
      await carregar();
      onChanged?.();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o imóvel.");
    } finally {
      setSalvando(false);
    }
  }

  const ultimaSincronizacaoOk = statusSync?.registros.find((r) => r.sucesso);

  return (
    <div>
      <PageHeader
        title="Marketing Imobiliário"
        icon={Building2}
        subtitle="Banco de imóveis para conteúdo e campanhas"
        actions={
          podeEditar ? (
            <Button onClick={() => setNovoAberto(true)}>
              <Plus size={16} /> Novo imóvel
            </Button>
          ) : undefined
        }
      />

      {/* Indicador de sincronização com o Imoview — "Imoview: não
          configurado" quando o backend não tem IMOVIEW_API_KEY, senão a
          data/hora da última rodada bem-sucedida + botão "Sincronizar
          agora" (só pra quem edita, mesmo gate de podeEditar do resto da
          tela). */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 px-4 py-3 rounded-[var(--radius-control)] border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
        {statusSync === null ? (
          <span className="text-gray-400">Verificando integração com o Imoview…</span>
        ) : !statusSync.ativa ? (
          <span className="text-gray-500 dark:text-slate-400">Integração com o Imoview: não configurada.</span>
        ) : (
          <span className="text-gray-600 dark:text-slate-300">
            Imoview: {ultimaSincronizacaoOk ? `última sincronização em ${fmtDataHora(ultimaSincronizacaoOk.executadoEm)}` : "ainda sem sincronização bem-sucedida"}
          </span>
        )}
        {statusSync?.ativa && podeEditar && (
          <Button variant="ghost" onClick={executarSincronizacao} disabled={sincronizando}>
            {sincronizando ? <Spinner size={14} /> : <Repeat size={14} />} Sincronizar agora
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex-1 min-w-[200px]">
          <SearchBox value={busca} onChange={setBusca} placeholder="Buscar por código, bairro/região ou corretor..." />
        </div>
        <Select value={filtroUnidade} onChange={(e) => setFiltroUnidade(e.target.value)} className="w-auto">
          <option value="">Todas as unidades</option>
          {data.dominios.unidades.map((u) => (
            <option key={u.id} value={u.id}>{u.nome}</option>
          ))}
        </Select>
        <Select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoImovel | "")} className="w-auto">
          <option value="">Todos os tipos</option>
          {Object.entries(TIPO_IMOVEL_LABEL).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>{rotulo}</option>
          ))}
        </Select>
        <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as StatusImovel | "")} className="w-auto">
          <option value="">Todos os status</option>
          {Object.entries(STATUS_IMOVEL_LABEL).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>{rotulo}</option>
          ))}
        </Select>
        <Select value={filtroPrioridade} onChange={(e) => setFiltroPrioridade(e.target.value as PrioridadeImovel | "")} className="w-auto">
          <option value="">Todas as prioridades</option>
          {Object.entries(PRIORIDADE_IMOVEL_LABEL).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>{rotulo}</option>
          ))}
        </Select>
      </div>

      {erro && <p className="text-sm text-brand-600 mb-3">{erro}</p>}

      {carregando ? (
        <div className="flex items-center justify-center py-16"><Spinner size={24} /></div>
      ) : imoveis.length === 0 ? (
        <EmptyState icon={Building2} text="Nenhum imóvel encontrado com esses filtros." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {imoveis.map((imovel) => (
            <button
              key={imovel.id}
              onClick={() => setImovelAberto(imovel)}
              className="text-left bg-white dark:bg-slate-900 rounded-[var(--radius-control)] border border-gray-200 dark:border-slate-700 p-4 shadow-[var(--elevation-1)] hover:shadow-[var(--elevation-2)] transition-shadow"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-semibold text-slate-900 dark:text-slate-100">{imovel.codigo}</p>
                <Stamp tone={STATUS_IMOVEL_TONE[imovel.status]}>{STATUS_IMOVEL_LABEL[imovel.status]}</Stamp>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                {TIPO_IMOVEL_LABEL[imovel.tipo]} · {imovel.unidade?.nome ?? "—"}
                {imovel.bairroRegiao ? ` · ${imovel.bairroRegiao}` : ""}
              </p>
              {imovel.descricaoCurta && (
                <p className="text-sm text-gray-600 dark:text-slate-300 line-clamp-2 mb-2">{imovel.descricaoCurta}</p>
              )}
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
                <span>{corretorLabel(imovel)}</span>
                <span className="font-medium">{imovel.valor ? fmtMoney(imovel.valor) : "—"}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {imovel.temFotos && <Camera size={14} className="text-gray-400" />}
                {imovel.temVideo && <Video size={14} className="text-gray-400" />}
                <span className="text-[10px] uppercase tracking-wide text-gray-400 ml-auto">{PRIORIDADE_IMOVEL_LABEL[imovel.prioridade]}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Paginacao
        pagina={meta.page}
        totalPaginas={meta.totalPages}
        onChange={setPagina}
        total={meta.total}
        inicioExibicao={meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1}
        fimExibicao={Math.min(meta.page * meta.pageSize, meta.total)}
        itemLabel="imóveis"
      />

      {(imovelAberto || novoAberto) && (
        <ImovelFormModal
          imovel={imovelAberto}
          data={data}
          podeEditar={podeEditar}
          salvando={salvando}
          onClose={() => { setImovelAberto(null); setNovoAberto(false); }}
          onSalvar={(dados) => salvar(dados, imovelAberto?.id ?? null)}
        />
      )}
    </div>
  );
}

function ImovelFormModal({
  imovel, data, podeEditar, salvando, onClose, onSalvar,
}: {
  imovel: ImovelMarketing | null;
  data: AppData;
  podeEditar: boolean;
  salvando: boolean;
  onClose: () => void;
  onSalvar: (dados: ImovelMarketingInput) => void;
}) {
  const somenteLeitura = !podeEditar;
  const [codigo, setCodigo] = useState(imovel?.codigo ?? "");
  const [unidadeId, setUnidadeId] = useState(imovel?.unidadeId ?? "");
  const [tipo, setTipo] = useState<TipoImovel>(imovel?.tipo ?? "APARTAMENTO");
  const [bairroRegiao, setBairroRegiao] = useState(imovel?.bairroRegiao ?? "");
  const [descricaoCurta, setDescricaoCurta] = useState(imovel?.descricaoCurta ?? "");
  const [valor, setValor] = useState(imovel?.valor != null ? String(imovel.valor) : "");
  const [corretorId, setCorretorId] = useState(imovel?.corretorId ?? "");
  const [corretorNome, setCorretorNome] = useState(imovel?.corretorNome ?? "");
  const [temFotos, setTemFotos] = useState(imovel?.temFotos ?? false);
  const [temVideo, setTemVideo] = useState(imovel?.temVideo ?? false);
  const [linkPasta, setLinkPasta] = useState(imovel?.linkPasta ?? "");
  const [prioridade, setPrioridade] = useState<PrioridadeImovel>(imovel?.prioridade ?? "B_PORTFOLIO");
  const [status, setStatus] = useState<StatusImovel>(imovel?.status ?? "DISPONIVEL");
  const [observacoes, setObservacoes] = useState(imovel?.observacoes ?? "");

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    onSalvar({
      codigo,
      unidadeId,
      tipo,
      bairroRegiao: bairroRegiao || null,
      descricaoCurta: descricaoCurta || null,
      valor: valor ? parseValorMonetario(valor) : null,
      corretorId: corretorId || null,
      corretorNome: corretorNome || null,
      temFotos,
      temVideo,
      linkPasta: linkPasta || null,
      prioridade,
      status,
      observacoes: observacoes || null,
    });
  }

  return (
    <Modal title={imovel ? `Imóvel ${imovel.codigo}` : "Novo imóvel"} onClose={onClose} wide>
      <form onSubmit={submeter}>
        {imovel?.origemImoview && (
          <div className="mb-4 px-3 py-2 rounded-[var(--radius-control)] bg-slate-50 dark:bg-slate-800 text-xs text-gray-600 dark:text-slate-300">
            Sincronizado do Imoview (código {imovel.codigoImoview})
            {imovel.ultimaSincronizacaoEm ? ` — última vez em ${fmtDataHora(imovel.ultimaSincronizacaoEm)}` : ""}.
            {" "}Código, unidade, tipo, bairro/região, descrição, valor, fotos/vídeo e status vêm do Imoview e são
            atualizados automaticamente; prioridade, corretor e observações continuam editáveis à mão.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Field label="Código">
            <TextInput value={codigo} onChange={(e) => setCodigo(e.target.value)} required disabled={somenteLeitura || imovel?.origemImoview} />
          </Field>
          <Field label="Unidade">
            <Select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} required disabled={somenteLeitura || imovel?.origemImoview}>
              <option value="">Selecione...</option>
              {data.dominios.unidades.map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoImovel)} disabled={somenteLeitura || imovel?.origemImoview}>
              {Object.entries(TIPO_IMOVEL_LABEL).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>{rotulo}</option>
              ))}
            </Select>
          </Field>
          <Field label="Bairro / Região">
            <TextInput value={bairroRegiao} onChange={(e) => setBairroRegiao(e.target.value)} disabled={somenteLeitura || imovel?.origemImoview} />
          </Field>
          <Field label="Valor (R$)">
            <TextInput value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" disabled={somenteLeitura || imovel?.origemImoview} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusImovel)} disabled={somenteLeitura}>
              {Object.entries(STATUS_IMOVEL_LABEL).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>{rotulo}</option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value as PrioridadeImovel)} disabled={somenteLeitura}>
              {Object.entries(PRIORIDADE_IMOVEL_LABEL).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>{rotulo}</option>
              ))}
            </Select>
          </Field>
          <Field label="Corretor cadastrado">
            <Select value={corretorId} onChange={(e) => setCorretorId(e.target.value)} disabled={somenteLeitura}>
              <option value="">Nenhum</option>
              {data.colaboradores.map((c) => (
                <option key={c.id} value={c.id}>{c.nomeCompleto}</option>
              ))}
            </Select>
          </Field>
          <Field label="Corretor (nome livre, se não cadastrado)">
            <TextInput value={corretorNome} onChange={(e) => setCorretorNome(e.target.value)} disabled={somenteLeitura} />
          </Field>
          <Field label="Link da pasta de mídia">
            <TextInput value={linkPasta} onChange={(e) => setLinkPasta(e.target.value)} placeholder="https://..." disabled={somenteLeitura} />
          </Field>
        </div>
        <div className="flex items-center gap-5 mb-3.5">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={temFotos} onChange={(e) => setTemFotos(e.target.checked)} disabled={somenteLeitura || imovel?.origemImoview} /> Tem fotos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={temVideo} onChange={(e) => setTemVideo(e.target.checked)} disabled={somenteLeitura || imovel?.origemImoview} /> Tem vídeo
          </label>
        </div>
        <Field label="Descrição curta">
          <TextArea value={descricaoCurta} onChange={(e) => setDescricaoCurta(e.target.value)} disabled={somenteLeitura || imovel?.origemImoview} />
        </Field>
        <Field label="Observações">
          <TextArea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} disabled={somenteLeitura} />
        </Field>
        {podeEditar && (
          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? <Spinner size={14} /> : null} Salvar</Button>
          </div>
        )}
      </form>
    </Modal>
  );
}
