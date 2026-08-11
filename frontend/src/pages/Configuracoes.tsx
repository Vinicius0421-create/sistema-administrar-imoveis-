import React, { useEffect, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { dominiosApi } from "../api/dominios";
import { acessosCanalExtraApi, AcessoCanalExtra } from "../api/mensagens";
import { ApiError } from "../lib/apiClient";
import { Button, Field, PageHeader, Select, Spinner, Stamp, TextArea, TextInput } from "../components/ui";
import { Pencil, Plus, Settings as SettingsIcon, MessageCircle } from "../components/icons";
import { UNIDADE_MEDIDA_PRODUTO_LABEL, UnidadeMedidaProduto } from "../types";
import { maskCnpj } from "../lib/mascaras";
import { useFeedback } from "../contexts/FeedbackContext";

interface Props {
  data: AppData;
  onChanged: () => void;
}

// Página "⚙️ Configurações" — sempre existiu na especificação original do
// sistema (09_Pagina_Configuracoes.md, era Airtable) mas nunca tinha sido
// construída na versão Node/React; a Evolução Completa (07/2026) pediu
// dropdowns administráveis também para Categoria/Marca de equipamento, então
// as 5 listas originais ganham companhia de mais 2 aqui. Uso raro por
// natureza — só quando muda a estrutura organizacional ou o catálogo de
// patrimônio — por isso fica isolada numa página própria, fora do fluxo do
// dia a dia. Restrita a ADMINISTRADOR (o backend também recusa para
// qualquer outro papel, esta tela só evita a pessoa tentar em vão).
export function ConfiguracoesPage({ data, onChanged }: Props) {
  return (
    <div>
      <PageHeader
        title="Configurações"
        icon={SettingsIcon}
        subtitle="Listas mestras usadas em todo o sistema. Não é necessário entrar aqui no dia a dia normal — só quando a estrutura organizacional ou o catálogo de patrimônio mudar."
      />

      {/* Achado de auditoria (08/07/2026, Etapa 7 — Responsividade): a
          quebra pra 2 colunas em `md` (768px) fazia cada painel ficar com
          ~230px de largura exatamente no breakpoint "tablet" — estreito
          demais pra caber nome + selo "ATIVO" + ícone de editar + link
          "excluir" na mesma linha, cortando "excluir" no meio ou escondendo
          por completo em vários itens (Setores, Unidades, Categorias). Em
          `lg` (1024px) cada painel já tem espaço de sobra pra isso — mobile
          (1 coluna, largura cheia) e notebook/desktop (2 colunas, painéis
          largos) não tinham esse problema. */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Achado de auditoria C6 (22/07/2026): dos 13 blocos de domínio
            desta página, só os 7 de baixo (Patrimônio de Equipamentos +
            Catálogo de Compras) tinham header de seção — o C2 (Fase 2)
            agrupou esses dois conjuntos mas deixou estes 5 primeiros soltos
            no topo do grid, sem nenhuma pista de que também formam um grupo
            (a base usada em cadastro de colaborador/acesso, sem relação
            direta com patrimônio ou catálogo de compras). O 13º bloco
            (Acesso extra a canal do chat) já é full-width com título próprio
            fora deste grid — não precisa de outro header por cima. */}
        <SecaoConfiguracoes
          titulo="Estrutura Organizacional e Acessos"
          subtitulo="Base usada no cadastro de Colaboradores e no controle de Acessos a sistemas — unidades, setores, cargos, empresas do grupo e sistemas de acesso."
        />
        <UnidadesBlock data={data} onChanged={onChanged} />
        <SetoresBlock data={data} onChanged={onChanged} />
        <CargosBlock data={data} onChanged={onChanged} />
        <EmpresasBlock data={data} onChanged={onChanged} />
        <SistemasAcessoBlock data={data} onChanged={onChanged} />

        {/* Achado de auditoria C2 (22/07/2026): "Categorias de Equipamento",
            "Categorias de Produto (Papelaria)" e "Categorias de Produto
            (Equipamento)" tinham título minimamente distinto mas ficavam uma
            embaixo da outra na mesma lista corrida, sem nenhuma separação
            visual — fácil de não perceber que são 2 domínios diferentes:
            classificar o PATRIMÔNIO já possuído (esta seção) vs. o CATÁLOGO
            de itens compráveis via solicitação (seção "Catálogo de Compras"
            logo abaixo). */}
        <SecaoConfiguracoes
          titulo="Patrimônio de Equipamentos"
          subtitulo="Classificação dos equipamentos já cadastrados como patrimônio da empresa (usada no formulário de cadastro de Equipamentos)."
        />
        <CategoriasEquipamentoBlock data={data} onChanged={onChanged} />
        <MarcasEquipamentoBlock data={data} onChanged={onChanged} />
        {/* Acessórios de Equipamento (17/07/2026, pedido do Vini: "cada
            categoria tem que ter seus acessório próprios") — mesmo molde de
            CategoriasProdutoEquipamento+ProdutosEquipamento acima, mas
            vinculado à Categoria de Equipamento (Notebook/Celular/...), a
            mesma lista usada no formulário de cadastro de Equipamento, não
            à Categoria de Produto de Equipamento (catálogo de solicitações,
            um conceito diferente). */}
        <AcessoriosEquipamentoBlock data={data} onChanged={onChanged} />

        {/* Papelaria e Compras (09/07/2026) — mesmo grid, 2 blocos novos ao
            lado dos 7 originais: um catálogo simples (Categorias) e um com FK
            obrigatória pra categoria + unidade de medida padrão (Produtos),
            mesmo racional de Categoria/Marca de Equipamento e Cargo acima.
            Achado C2 (22/07/2026): agrupados sob um único header — os dois
            blocos de Categoria de Produto (Papelaria/Equipamento) são o
            mesmo conceito (catálogo do que pode ser SOLICITADO/COMPRADO), só
            em domínios de compra diferentes, ao contrário de "Categoria de
            Equipamento" acima (que classifica o que a empresa JÁ TEM). */}
        <SecaoConfiguracoes
          titulo="Catálogo de Compras"
          subtitulo="Itens que podem ser solicitados/comprados via Papelaria ou Solicitação de Equipamento — não confundir com o Patrimônio de Equipamentos acima."
        />
        <CategoriasProdutoPapelariaBlock data={data} onChanged={onChanged} />
        <ProdutosPapelariaBlock data={data} onChanged={onChanged} />
        {/* Solicitação de Equipamentos (09/07/2026, "Ajuste na Estrutura das
            Solicitações") — mesmo molde dos 2 blocos de Papelaria acima, só
            que sem unidade de medida (equipamento é sempre por unidade). */}
        <CategoriasProdutoEquipamentoBlock data={data} onChanged={onChanged} />
        <ProdutosEquipamentoBlock data={data} onChanged={onChanged} />
      </div>

      <div className="mt-4">
        <AcessosCanalExtraBlock data={data} />
      </div>
    </div>
  );
}

// Header de seção dentro do grid 2 colunas (achado C2, 22/07/2026) — usa
// `lg:col-span-2` pra ocupar a largura cheia do grid como um separador real
// entre grupos de blocos, em vez de mais um card na mesma lista corrida.
// Estilo deliberadamente maior que os `<h3>` de cada bloco individual
// (ListaSimplesBlock/CargosBlock/etc, ver `font-semibold text-sm` deles) pra
// deixar claro visualmente que isto é um nível acima — um domínio, não uma
// lista.
function SecaoConfiguracoes({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div className="lg:col-span-2 pt-2 border-t border-gray-200 dark:border-slate-700 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{titulo}</h2>
      {subtitulo && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 max-w-2xl">{subtitulo}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------
// Acessos extra a canal do chat interno (08/07/2026, pedido do Vini: "os
// que você achar pertinente ter acesso a vários canais pode deixar" — ex:
// Locação também acompanha Sucesso do Cliente). Por padrão um colaborador
// só participa do canal do próprio setor/unidade (ver GET /mensagens/
// canais-disponiveis); esta tela deixa o ADMINISTRADOR abrir exceções sem
// precisar pedir uma migration/seed a cada caso novo. Full-width, fora do
// grid 2 colunas das outras listas — o formulário tem mais campos.
// -----------------------------------------------------------------------
function AcessosCanalExtraBlock({ data }: { data: AppData }) {
  const { sucesso } = useFeedback();
  const [itens, setItens] = useState<AcessoCanalExtra[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pendente, setPendente] = useState<string | null>(null);

  const [origemTipo, setOrigemTipo] = useState<"setor" | "colaborador">("setor");
  const [setorOrigemId, setSetorOrigemId] = useState("");
  const [colaboradorId, setColaboradorId] = useState("");
  const [destinoTipo, setDestinoTipo] = useState<"CANAL_SETOR" | "CANAL_UNIDADE">("CANAL_SETOR");
  const [destinoId, setDestinoId] = useState("");
  const [observacao, setObservacao] = useState("");

  async function carregar() {
    setCarregando(true);
    try {
      setItens(await acessosCanalExtraApi.listar());
    } catch {
      // silencioso — não é uma tela de uso diário
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  async function criar() {
    setErro(null);
    if (origemTipo === "setor" && !setorOrigemId) return setErro("Escolha o setor de origem.");
    if (origemTipo === "colaborador" && !colaboradorId) return setErro("Escolha o colaborador.");
    if (!destinoId) return setErro("Escolha o canal concedido.");
    setSalvando(true);
    try {
      await acessosCanalExtraApi.criar({
        setorOrigemId: origemTipo === "setor" ? setorOrigemId : undefined,
        colaboradorId: origemTipo === "colaborador" ? colaboradorId : undefined,
        tipo: destinoTipo,
        setorDestinoId: destinoTipo === "CANAL_SETOR" ? destinoId : undefined,
        unidadeDestinoId: destinoTipo === "CANAL_UNIDADE" ? destinoId : undefined,
        observacao: observacao.trim() || undefined,
      });
      setSetorOrigemId("");
      setColaboradorId("");
      setDestinoId("");
      setObservacao("");
      await carregar();
      sucesso("Acesso ao canal concedido.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar o acesso extra.");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    setPendente(id);
    try {
      await acessosCanalExtraApi.remover(id);
      await carregar();
      sucesso("Acesso removido.");
    } catch {
      setErro("Não foi possível remover.");
    } finally {
      setPendente(null);
    }
  }

  function descreverOrigem(a: AcessoCanalExtra): string {
    if (a.colaborador) return a.colaborador.nomeCompleto;
    if (a.setorOrigem) return `Todo o setor ${a.setorOrigem.nome}`;
    return "—";
  }
  function descreverDestino(a: AcessoCanalExtra): string {
    if (a.tipo === "CANAL_SETOR") return `# ${a.setorDestino?.nome || "—"}`;
    return `# ${a.unidadeDestino?.nome || "—"}`;
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><MessageCircle size={15} /> Acesso extra a canal do chat</h3>
      </div>
      <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">
        Por padrão, cada colaborador só participa do canal do próprio setor e unidade. Use aqui pra abrir exceções — ex: "Locação também acompanha
        Sucesso do Cliente" (regra pro setor inteiro) ou dar acesso pontual a uma pessoa específica.
      </p>

      {erro && <div className="mb-3 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

      <div className="grid sm:grid-cols-2 gap-3 mb-3 bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
        <Field label="Quem ganha o acesso">
          <div className="flex gap-3 text-xs mb-1.5">
            <label className="flex items-center gap-1"><input type="radio" checked={origemTipo === "setor"} onChange={() => setOrigemTipo("setor")} /> Setor inteiro</label>
            <label className="flex items-center gap-1"><input type="radio" checked={origemTipo === "colaborador"} onChange={() => setOrigemTipo("colaborador")} /> Pessoa específica</label>
          </div>
          {origemTipo === "setor" ? (
            <Select value={setorOrigemId} onChange={(e) => setSetorOrigemId(e.target.value)}>
              <option value="">Selecione o setor...</option>
              {data.dominios.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </Select>
          ) : (
            <Select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)}>
              <option value="">Selecione o colaborador...</option>
              {data.colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nomeCompleto}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Canal concedido">
          <div className="flex gap-3 text-xs mb-1.5">
            <label className="flex items-center gap-1"><input type="radio" checked={destinoTipo === "CANAL_SETOR"} onChange={() => { setDestinoTipo("CANAL_SETOR"); setDestinoId(""); }} /> Setor</label>
            <label className="flex items-center gap-1"><input type="radio" checked={destinoTipo === "CANAL_UNIDADE"} onChange={() => { setDestinoTipo("CANAL_UNIDADE"); setDestinoId(""); }} /> Unidade</label>
          </div>
          <Select value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
            <option value="">Selecione...</option>
            {(destinoTipo === "CANAL_SETOR" ? data.dominios.setores : data.dominios.unidades).map((d) => (
              <option key={d.id} value={d.id}>{d.nome}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observação (opcional)">
            <TextInput value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex: acompanha entregas em andamento" />
          </Field>
        </div>
        <div className="sm:col-span-2 flex justify-end">
          {/* Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): não trocava
              o texto pra "Concedendo..." durante o salvamento — inconsistente
              com o padrão do resto do sistema (mesmo já tendo o `disabled`
              certo, que evita double-submit). */}
          <Button variant="primary" onClick={criar} disabled={salvando}>
            <Plus size={14} /> {salvando ? "Concedendo..." : "Conceder acesso"}
          </Button>
        </div>
      </div>

      {carregando ? (
        // Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): texto estático
        // sem <Spinner>, único lugar do sistema ainda fazendo isso — padrão
        // já usado em Mensagens.tsx/ImportarImoview.tsx/LoadingState.
        <p className="text-xs text-gray-400 dark:text-slate-500 flex items-center gap-2 animate-[fadeIn_var(--motion-fast)_ease-out]"><Spinner size={13} /> Carregando...</p>
      ) : itens.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500">Nenhuma exceção cadastrada — todo mundo vê só o canal do próprio setor/unidade.</p>
      ) : (
        <div className="space-y-1.5">
          {itens.map((a) => (
            // Achado de auditoria (Etapa 4 — Frontend, 08/07/2026): texto livre
            // (nome de setor + observação digitada) sem `min-w-0`/`truncate`
            // podia empurrar o botão "remover" pra fora da tela em telas
            // estreitas — sem chegar a quebrar letra por letra (falta
            // break-words), mas o mesmo tipo de disputa de espaço já corrigido
            // em Linhas.tsx.
            <div key={a.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-gray-100 last:border-0">
              <span className="text-slate-700 dark:text-slate-300 min-w-0 truncate" title={`${descreverOrigem(a)} → também acompanha ${descreverDestino(a)}${a.observacao ? ` · ${a.observacao}` : ""}`}>
                <span className="font-medium">{descreverOrigem(a)}</span> <span className="text-gray-400 dark:text-slate-500">→ também acompanha</span>{" "}
                <span className="font-medium">{descreverDestino(a)}</span>
                {a.observacao && <span className="text-gray-400 dark:text-slate-500"> · {a.observacao}</span>}
              </span>
              <button
                className="text-gray-500 dark:text-slate-400 hover:text-brand-600 text-xs flex-shrink-0"
                disabled={pendente === a.id}
                onClick={() => remover(a.id)}
              >
                remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Bloco genérico: lista + "+ Novo" + ativar/inativar, reaproveitado pelas
// listas simples nome/status (Unidades, Setores, Categorias, Marcas etc).
//
// Achado de auditoria C5 (22/07/2026): 6 blocos desta página (Empresas,
// Sistemas de Acesso, Produtos de Papelaria, Produtos de Equipamento,
// Acessórios de Equipamento) reimplementavam manualmente este mesmo padrão
// de lista+criar+editar+excluir só porque precisavam de 1-2 campos extras
// (CNPJ, descrição, categoria vinculada, unidade de medida) que a versão
// original não suportava — puro código duplicado, sem diferença real de
// comportamento. `camposExtras` abaixo generaliza isso: cada campo extra
// declara label/tipo/obrigatoriedade/opções (pra select) e o bloco cuida de
// exibir o input certo tanto no formulário de criação quanto no de edição,
// validar obrigatoriedade antes de habilitar "Salvar" e devolver os valores
// pro chamador via `onCriar`/`onRenomear`. `renderDetalhe` cobre a segunda
// linha de texto que cada um desses blocos mostrava abaixo do nome (CNPJ,
// descrição, "Categoria · Unidade"). `status` também virou opcional: Cargo,
// Empresa e Sistema de Acesso nunca tiveram Ativo/Inativo — só é exibido
// quando `onAlternarStatus` é passado. Mensagens de sucesso/erro
// continuam customizáveis (`mensagem*`) porque cada bloco original usava um
// texto ligeiramente diferente ("Produto cadastrado." vs "Empresa
// cadastrada." etc.) e a migração preserva esse texto exato.
//
// CargosBlock NÃO foi migrado pra cá: ele agrupa os cargos por setor com
// headers de seção (`Object.entries(porSetor)`), uma estrutura de exibição
// hierárquica bem diferente da lista plana que este componente renderiza —
// forçar isso aqui seria generalização arriscada só pra "bater a meta",
// então ficou de fora e continua com implementação manual própria.
// -----------------------------------------------------------------------
interface CampoExtraConfig {
  chave: string;
  label: string;
  tipo: "text" | "textarea" | "select";
  obrigatorio?: boolean;
  opcoes?: { value: string; label: string }[];
  placeholder?: string;
  valorPadrao?: string;
  // Ex: maskCnpj — aplicada a cada onChange, igual ao campo CNPJ original.
  mascara?: (valor: string) => string;
}

function valoresExtrasIniciais(camposExtras?: CampoExtraConfig[]): Record<string, string> {
  const base: Record<string, string> = {};
  (camposExtras || []).forEach((c) => { base[c.chave] = c.valorPadrao || ""; });
  return base;
}

function CampoExtraInput({
  config, valor, onChange, comOpcaoVazia,
}: {
  config: CampoExtraConfig;
  valor: string;
  onChange: (v: string) => void;
  comOpcaoVazia: boolean;
}) {
  if (config.tipo === "select") {
    return (
      <Select value={valor} onChange={(e) => onChange(e.target.value)} className="!py-1 !text-sm">
        {comOpcaoVazia && <option value="">—</option>}
        {(config.opcoes || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    );
  }
  if (config.tipo === "textarea") {
    return <TextArea value={valor} onChange={(e) => onChange(e.target.value)} placeholder={config.placeholder} />;
  }
  return (
    <TextInput
      value={valor}
      onChange={(e) => onChange(config.mascara ? config.mascara(e.target.value) : e.target.value)}
      placeholder={config.placeholder}
      className="!py-1 !text-sm"
    />
  );
}

function ListaSimplesBlock<T extends { id: string; nome: string; status?: "ATIVO" | "INATIVO" }>({
  titulo, itens, novoLabel, campoLabel, placeholderNome, camposExtras, valoresIniciaisExtras, renderDetalhe,
  onCriar, onAlternarStatus, onRenomear, onExcluir,
  mensagemCriado, mensagemAtualizado, mensagemExcluido, mensagemErroEdicao,
}: {
  titulo: string;
  itens: T[];
  novoLabel: string;
  campoLabel: string;
  placeholderNome?: string;
  // Campos extras (CNPJ, descrição, categoria vinculada, unidade de medida
  // padrão...) que alguns domínios precisam além de nome/status — ver
  // comentário acima do componente.
  camposExtras?: CampoExtraConfig[];
  valoresIniciaisExtras?: (item: T) => Record<string, string>;
  renderDetalhe?: (item: T) => React.ReactNode;
  onCriar: (nome: string, extras: Record<string, string>) => Promise<void>;
  // Achado de auditoria (06/07/2026): a API de domínio (dominiosApi.atualizarX)
  // já aceitava trocar o nome desde a Fase 1 — só faltava a tela ligar isso.
  // Antes, corrigir um nome digitado errado (typo num setor, por exemplo)
  // exigia excluir e recriar, o que quebrava qualquer coisa já vinculada.
  onRenomear: (id: string, novoNome: string, extras: Record<string, string>) => Promise<void>;
  // Opcional: Cargo/Empresa/Sistema de Acesso não têm status ATIVO/INATIVO.
  onAlternarStatus?: (id: string, statusAtual: "ATIVO" | "INATIVO") => Promise<void>;
  // Todas as listas de domínio têm exclusão definitiva. Unidade/Cargo/
  // Empresa/Categoria/Marca são seguras por definição (FK opcional + ON
  // DELETE SET NULL: excluir nunca deixa nada inconsistente, só remove o
  // vínculo). Setor e Sistema de Acesso têm dependentes obrigatórios
  // (Cargo.setorId, AcessoSistema.sistemaId) — o backend recusa com 409 e
  // uma mensagem explicando o que precisa ser resolvido antes; por isso o
  // erro é sempre exibido aqui, não só um "não foi possível" genérico.
  onExcluir?: (id: string) => Promise<void>;
  mensagemCriado?: string;
  mensagemAtualizado?: string;
  mensagemExcluido?: string;
  mensagemErroEdicao?: string;
}) {
  const { sucesso } = useFeedback();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [extras, setExtras] = useState<Record<string, string>>(() => valoresExtrasIniciais(camposExtras));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");
  const [extrasEdicao, setExtrasEdicao] = useState<Record<string, string>>({});

  const camposObrigatoriosPreenchidos = (valores: Record<string, string>) =>
    (camposExtras || []).every((c) => !c.obrigatorio || (valores[c.chave] || "").trim());

  async function salvar() {
    if (!nome.trim() || !camposObrigatoriosPreenchidos(extras)) return;
    setSalvando(true);
    setErro(null);
    try {
      await onCriar(nome.trim(), extras);
      setNome("");
      setExtras(valoresExtrasIniciais(camposExtras));
      setCriando(false);
      sucesso(mensagemCriado || `${titulo} criado(a) com sucesso.`);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(id: string, statusAtual: "ATIVO" | "INATIVO") {
    if (!onAlternarStatus) return;
    setPendente(id);
    try {
      await onAlternarStatus(id, statusAtual);
      sucesso("Status atualizado.");
    } finally {
      setPendente(null);
    }
  }

  async function renomear(id: string) {
    if (!nomeEdicao.trim() || !camposObrigatoriosPreenchidos(extrasEdicao)) return;
    setPendente(id);
    setErro(null);
    try {
      await onRenomear(id, nomeEdicao.trim(), extrasEdicao);
      setEditandoId(null);
      sucesso(mensagemAtualizado || "Nome atualizado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : (mensagemErroEdicao || "Não foi possível renomear."));
    } finally {
      setPendente(null);
    }
  }

  async function excluir(id: string) {
    if (!onExcluir) return;
    setPendente(id);
    setErro(null);
    try {
      await onExcluir(id);
      setConfirmandoExcluir(null);
      sucesso(mensagemExcluido || "Registro excluído.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setPendente(null);
    }
  }

  function iniciarEdicao(item: T) {
    setEditandoId(item.id);
    setNomeEdicao(item.nome);
    setExtrasEdicao(valoresIniciaisExtras ? valoresIniciaisExtras(item) : {});
  }

  const temExtras = (camposExtras?.length ?? 0) > 0;

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{titulo}</h3>
        {/* Achado de auditoria (08/07/2026, Etapa 8 — Consistência): em toda
            outra página do sistema, o botão de criar um novo registro usa
            `variant="accent"` + ícone `size={16}` (ver "Novo Equipamento",
            "Novo Acesso" etc.) — só em Configurações os botões equivalentes
            usavam `ghost` + `size={14}`, tornando a ação de criar menos
            visível justamente na página onde ela é o propósito principal. */}
        <Button variant="accent" onClick={() => setCriando(true)}>
          <Plus size={16} /> {novoLabel}
        </Button>
      </div>

      {criando && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg">
          {erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
          <Field label={campoLabel}>
            <TextInput value={nome} onChange={(e) => setNome(e.target.value)} placeholder={placeholderNome} autoFocus />
          </Field>
          {(camposExtras || []).map((c) => (
            <Field key={c.chave} label={c.label}>
              <CampoExtraInput
                config={c}
                valor={extras[c.chave] ?? ""}
                onChange={(v) => setExtras((prev) => ({ ...prev, [c.chave]: v }))}
                comOpcaoVazia
              />
            </Field>
          ))}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => { setCriando(false); setNome(""); setExtras(valoresExtrasIniciais(camposExtras)); }}>Cancelar</Button>
            <Button variant="primary" onClick={salvar} disabled={!nome.trim() || !camposObrigatoriosPreenchidos(extras) || salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {!criando && erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {itens.map((item) => (
          <div key={item.id} className={temExtras ? "text-sm py-1.5 border-b border-gray-100 last:border-0" : "flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0 gap-2"}>
            {editandoId === item.id ? (
              temExtras ? (
                <div className="space-y-1.5 py-1">
                  <TextInput
                    value={nomeEdicao}
                    onChange={(e) => setNomeEdicao(e.target.value)}
                    autoFocus
                    placeholder={campoLabel}
                    className="!py-1 !text-sm"
                  />
                  {(camposExtras || []).map((c) => (
                    <CampoExtraInput
                      key={c.chave}
                      config={c}
                      valor={extrasEdicao[c.chave] ?? ""}
                      onChange={(v) => setExtrasEdicao((prev) => ({ ...prev, [c.chave]: v }))}
                      comOpcaoVazia={false}
                    />
                  ))}
                  <div className="flex items-center gap-1.5">
                    <button className="text-brand-700 dark:text-brand-400 font-semibold text-xs whitespace-nowrap" disabled={pendente === item.id || !nomeEdicao.trim() || !camposObrigatoriosPreenchidos(extrasEdicao)} onClick={() => renomear(item.id)}>
                      salvar
                    </button>
                    <button className="text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap" onClick={() => setEditandoId(null)}>cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-1">
                  <TextInput
                    value={nomeEdicao}
                    onChange={(e) => setNomeEdicao(e.target.value)}
                    autoFocus
                    className="!py-1 !text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter") renomear(item.id); if (e.key === "Escape") setEditandoId(null); }}
                  />
                  <button className="text-brand-700 dark:text-brand-400 font-semibold text-xs whitespace-nowrap" disabled={pendente === item.id || !nomeEdicao.trim()} onClick={() => renomear(item.id)}>
                    salvar
                  </button>
                  <button className="text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap" onClick={() => setEditandoId(null)}>cancelar</button>
                </div>
              )
            ) : temExtras ? (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={item.status === "INATIVO" ? "text-gray-400 dark:text-slate-500 line-through" : "text-slate-800"}>{item.nome}</p>
                  {renderDetalhe && <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{renderDetalhe(item)}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {onAlternarStatus && item.status && (
                    <button onClick={() => alternar(item.id, item.status!)} disabled={pendente === item.id} className="disabled:opacity-50" title="Clique para ativar/inativar">
                      <Stamp tone={item.status === "ATIVO" ? "pos" : "neg"}>{item.status === "ATIVO" ? "Ativo" : "Inativo"}</Stamp>
                    </button>
                  )}
                  <button className="text-gray-500 dark:text-slate-400 hover:text-brand-600" title="Editar" aria-label={`Editar ${item.nome}`} onClick={() => iniciarEdicao(item)}>
                    <Pencil size={12} />
                  </button>
                  {onExcluir && (
                    confirmandoExcluir === item.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <button className="text-brand-700 dark:text-brand-400 font-semibold" disabled={pendente === item.id} onClick={() => excluir(item.id)}>confirmar</button>
                        <button className="text-gray-500 dark:text-slate-400" onClick={() => setConfirmandoExcluir(null)}>cancelar</button>
                      </span>
                    ) : (
                      <button className="text-gray-500 dark:text-slate-400 hover:text-brand-600 text-xs" title="Excluir definitivamente" onClick={() => setConfirmandoExcluir(item.id)}>
                        excluir
                      </button>
                    )
                  )}
                </div>
              </div>
            ) : (
              <span className={item.status === "INATIVO" ? "text-gray-400 dark:text-slate-500 line-through" : "text-slate-800"}>{item.nome}</span>
            )}
            {editandoId !== item.id && !temExtras && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {onAlternarStatus && item.status && (
                  <button
                    onClick={() => alternar(item.id, item.status!)}
                    disabled={pendente === item.id}
                    className="disabled:opacity-50"
                    title="Clique para ativar/inativar"
                  >
                    <Stamp tone={item.status === "ATIVO" ? "pos" : "neg"}>{item.status === "ATIVO" ? "Ativo" : "Inativo"}</Stamp>
                  </button>
                )}
                <button
                  className="text-gray-500 dark:text-slate-400 hover:text-brand-600"
                  title="Editar nome"
                  aria-label={`Editar nome de ${item.nome}`}
                  onClick={() => iniciarEdicao(item)}
                >
                  <Pencil size={12} />
                </button>
                {onExcluir && (
                  confirmandoExcluir === item.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <button className="text-brand-700 dark:text-brand-400 font-semibold" disabled={pendente === item.id} onClick={() => excluir(item.id)}>confirmar</button>
                      <button className="text-gray-500 dark:text-slate-400" onClick={() => setConfirmandoExcluir(null)}>cancelar</button>
                    </span>
                  ) : (
                    <button className="text-gray-500 dark:text-slate-400 hover:text-brand-600 text-xs" title="Excluir definitivamente" onClick={() => setConfirmandoExcluir(item.id)}>
                      excluir
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
        {itens.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum registro ainda.</p>}
      </div>
    </div>
  );
}

function UnidadesBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Unidades"
      itens={data.dominios.unidades}
      novoLabel="Nova Unidade"
      campoLabel="Nome da unidade"
      onCriar={async (nome) => { await dominiosApi.criarUnidade(nome); await onChanged(); }}
      onAlternarStatus={async (id, atual) => { await dominiosApi.atualizarUnidade(id, { status: atual === "ATIVO" ? "INATIVO" : "ATIVO" }); await onChanged(); }}
      onRenomear={async (id, nome) => { await dominiosApi.atualizarUnidade(id, { nome }); await onChanged(); }}
      onExcluir={async (id) => { await dominiosApi.removerUnidade(id); await onChanged(); }}
    />
  );
}

function SetoresBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Setores"
      itens={data.dominios.setores}
      novoLabel="Novo Setor"
      campoLabel="Nome do setor"
      onCriar={async (nome) => { await dominiosApi.criarSetor(nome); await onChanged(); }}
      onAlternarStatus={async (id, atual) => { await dominiosApi.atualizarSetor(id, { status: atual === "ATIVO" ? "INATIVO" : "ATIVO" }); await onChanged(); }}
      onRenomear={async (id, nome) => { await dominiosApi.atualizarSetor(id, { nome }); await onChanged(); }}
      onExcluir={async (id) => { await dominiosApi.removerSetor(id); await onChanged(); }}
    />
  );
}

function CategoriasEquipamentoBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Categorias de Equipamento"
      itens={data.dominios.categoriasEquipamento}
      novoLabel="Nova Categoria"
      campoLabel="Nome da categoria"
      onCriar={async (nome) => { await dominiosApi.criarCategoriaEquipamento(nome); await onChanged(); }}
      onAlternarStatus={async (id, atual) => { await dominiosApi.atualizarCategoriaEquipamento(id, { status: atual === "ATIVO" ? "INATIVO" : "ATIVO" }); await onChanged(); }}
      onRenomear={async (id, nome) => { await dominiosApi.atualizarCategoriaEquipamento(id, { nome }); await onChanged(); }}
      onExcluir={async (id) => { await dominiosApi.removerCategoriaEquipamento(id); await onChanged(); }}
    />
  );
}

function MarcasEquipamentoBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Marcas de Equipamento"
      itens={data.dominios.marcasEquipamento}
      novoLabel="Nova Marca"
      campoLabel="Nome da marca"
      onCriar={async (nome) => { await dominiosApi.criarMarcaEquipamento(nome); await onChanged(); }}
      onAlternarStatus={async (id, atual) => { await dominiosApi.atualizarMarcaEquipamento(id, { status: atual === "ATIVO" ? "INATIVO" : "ATIVO" }); await onChanged(); }}
      onRenomear={async (id, nome) => { await dominiosApi.atualizarMarcaEquipamento(id, { nome }); await onChanged(); }}
      onExcluir={async (id) => { await dominiosApi.removerMarcaEquipamento(id); await onChanged(); }}
    />
  );
}

// Cargos precisam de um Setor vinculado — não cabe no bloco genérico acima.
function CargosBlock({ data, onChanged }: Props) {
  const { sucesso } = useFeedback();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [setorId, setSetorId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");

  async function salvar() {
    if (!nome.trim() || !setorId) return;
    setSalvando(true);
    setErro(null);
    try {
      await dominiosApi.criarCargo(nome.trim(), setorId);
      await onChanged();
      setNome("");
      setSetorId("");
      setCriando(false);
      sucesso("Cargo criado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  // Achado de auditoria (06/07/2026): corrigir um cargo digitado errado
  // exigia excluir e recriar, perdendo o vínculo com colaboradores já
  // atribuídos a ele (cargoId vira null). Renomear no lugar preserva o vínculo.
  async function renomear(id: string) {
    if (!nomeEdicao.trim()) return;
    setPendente(id);
    setErro(null);
    try {
      await dominiosApi.atualizarCargo(id, { nome: nomeEdicao.trim() });
      await onChanged();
      setEditandoId(null);
      sucesso("Cargo renomeado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível renomear.");
    } finally {
      setPendente(null);
    }
  }

  // Seguro por definição: colaboradores.cargoId é opcional com ON DELETE
  // SET NULL — excluir um cargo nunca deixa colaborador em estado
  // inconsistente, só remove o vínculo.
  async function excluir(id: string) {
    setPendente(id);
    setErro(null);
    try {
      await dominiosApi.removerCargo(id);
      await onChanged();
      setConfirmandoExcluir(null);
      sucesso("Cargo excluído.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setPendente(null);
    }
  }

  const porSetor = data.dominios.cargos.reduce<Record<string, typeof data.dominios.cargos>>((acc, c) => {
    const key = c.setor?.nome || "(sem setor)";
    (acc[key] ||= []).push(c);
    return acc;
  }, {});

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Cargos</h3>
        <Button variant="accent" onClick={() => setCriando(true)}>
          <Plus size={16} /> Novo Cargo
        </Button>
      </div>

      {criando && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg">
          {erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
          <Field label="Nome do cargo">
            <TextInput value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </Field>
          <Field label="Setor">
            <Select value={setorId} onChange={(e) => setSetorId(e.target.value)}>
              <option value="">—</option>
              {data.dominios.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => { setCriando(false); setNome(""); setSetorId(""); }}>Cancelar</Button>
            <Button variant="primary" onClick={salvar} disabled={!nome.trim() || !setorId || salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {!criando && erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {Object.entries(porSetor).map(([setor, cargos]) => (
          <div key={setor}>
            <p className="text-[11px] uppercase text-gray-400 dark:text-slate-500 font-semibold">{setor}</p>
            {cargos.map((c) => (
              <div key={c.id} className="flex items-center justify-between pl-2 gap-2">
                {editandoId === c.id ? (
                  <div className="flex items-center gap-1.5 flex-1 py-1">
                    <TextInput
                      value={nomeEdicao}
                      onChange={(e) => setNomeEdicao(e.target.value)}
                      autoFocus
                      className="!py-1 !text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter") renomear(c.id); if (e.key === "Escape") setEditandoId(null); }}
                    />
                    <button className="text-brand-700 dark:text-brand-400 font-semibold text-xs whitespace-nowrap" disabled={pendente === c.id || !nomeEdicao.trim()} onClick={() => renomear(c.id)}>salvar</button>
                    <button className="text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap" onClick={() => setEditandoId(null)}>cancelar</button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-slate-800">{c.nome}</p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button className="text-gray-500 dark:text-slate-400 hover:text-brand-600" title="Editar nome" aria-label={`Editar nome do cargo ${c.nome}`} onClick={() => { setEditandoId(c.id); setNomeEdicao(c.nome); }}>
                        <Pencil size={12} />
                      </button>
                      {confirmandoExcluir === c.id ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button className="text-brand-700 dark:text-brand-400 font-semibold" disabled={pendente === c.id} onClick={() => excluir(c.id)}>confirmar</button>
                          <button className="text-gray-500 dark:text-slate-400" onClick={() => setConfirmandoExcluir(null)}>cancelar</button>
                        </span>
                      ) : (
                        <button className="text-gray-500 dark:text-slate-400 hover:text-brand-600 text-xs" title="Excluir definitivamente" onClick={() => setConfirmandoExcluir(c.id)}>
                          excluir
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
        {data.dominios.cargos.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum cargo cadastrado ainda.</p>}
      </div>
    </div>
  );
}

// Empresas têm um campo extra (CNPJ) — migrado pra ListaSimplesBlock via
// `camposExtras` (achado C5, 22/07/2026). O campo principal do domínio é
// `razaoSocial`, não `nome`; o adaptador `itens` abaixo remapeia pra `nome`
// só pra alimentar o componente genérico, e os handlers devolvem pro
// formato de API original (`{ razaoSocial, cnpj }`).
function EmpresasBlock({ data, onChanged }: Props) {
  const itens = data.dominios.empresas.map((e) => ({ ...e, nome: e.razaoSocial }));
  return (
    <ListaSimplesBlock
      titulo="Empresas"
      itens={itens}
      novoLabel="Nova Empresa"
      campoLabel="Razão Social"
      camposExtras={[{ chave: "cnpj", label: "CNPJ (opcional)", tipo: "text", placeholder: "00.000.000/0000-00", mascara: maskCnpj }]}
      valoresIniciaisExtras={(item) => ({ cnpj: item.cnpj || "" })}
      renderDetalhe={(item) => item.cnpj || null}
      onCriar={async (razaoSocial, extras) => { await dominiosApi.criarEmpresa({ razaoSocial, cnpj: extras.cnpj || null }); await onChanged(); }}
      onRenomear={async (id, razaoSocial, extras) => { await dominiosApi.atualizarEmpresa(id, { razaoSocial, cnpj: extras.cnpj || null }); await onChanged(); }}
      // Seguro por definição: linhas_telefonicas.empresaId é opcional com ON
      // DELETE SET NULL.
      onExcluir={async (id) => { await dominiosApi.removerEmpresa(id); await onChanged(); }}
      mensagemCriado="Empresa cadastrada."
      mensagemAtualizado="Empresa atualizada."
      mensagemExcluido="Empresa excluída."
      mensagemErroEdicao="Não foi possível salvar as alterações."
    />
  );
}

// Sistemas de Acesso têm um campo extra (descrição) — migrado pra
// ListaSimplesBlock via `camposExtras` (achado C5, 22/07/2026).
function SistemasAcessoBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Sistemas de Acesso"
      itens={data.dominios.sistemas}
      novoLabel="Novo Sistema"
      campoLabel="Nome do sistema"
      camposExtras={[{ chave: "descricao", label: "Descrição (opcional)", tipo: "textarea" }]}
      valoresIniciaisExtras={(item) => ({ descricao: item.descricao || "" })}
      renderDetalhe={(item) => item.descricao || null}
      onCriar={async (nome, extras) => { await dominiosApi.criarSistemaAcesso({ nome, descricao: extras.descricao || null }); await onChanged(); }}
      onRenomear={async (id, nome, extras) => { await dominiosApi.atualizarSistemaAcesso(id, { nome, descricao: extras.descricao || null }); await onChanged(); }}
      // acessos_sistema.sistemaId é obrigatório com ON DELETE RESTRICT — o
      // backend recusa com 409 se algum colaborador ainda tiver acesso
      // concedido a este sistema, e a mensagem exata aparece aqui.
      onExcluir={async (id) => { await dominiosApi.removerSistemaAcesso(id); await onChanged(); }}
      mensagemCriado="Sistema cadastrado."
      mensagemAtualizado="Sistema atualizado."
      mensagemExcluido="Sistema excluído."
      mensagemErroEdicao="Não foi possível salvar as alterações."
    />
  );
}

function CategoriasProdutoPapelariaBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Categorias de Produto (Papelaria)"
      itens={data.dominios.categoriasProdutoPapelaria}
      novoLabel="Nova Categoria"
      campoLabel="Nome da categoria"
      onCriar={async (nome) => { await dominiosApi.criarCategoriaProdutoPapelaria(nome); await onChanged(); }}
      onAlternarStatus={async (id, atual) => { await dominiosApi.atualizarCategoriaProdutoPapelaria(id, { status: atual === "ATIVO" ? "INATIVO" : "ATIVO" }); await onChanged(); }}
      onRenomear={async (id, nome) => { await dominiosApi.atualizarCategoriaProdutoPapelaria(id, { nome }); await onChanged(); }}
      onExcluir={async (id) => { await dominiosApi.removerCategoriaProdutoPapelaria(id); await onChanged(); }}
    />
  );
}

// Produtos de Papelaria precisam de uma Categoria vinculada (obrigatória) e
// de uma unidade de medida padrão — migrado pra ListaSimplesBlock via
// `camposExtras` (achado C5, 22/07/2026); CargosBlock continua manual (ver
// comentário acima de ListaSimplesBlock).
function ProdutosPapelariaBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Produtos de Papelaria"
      itens={data.dominios.produtosPapelaria}
      novoLabel="Novo Produto"
      campoLabel="Nome do produto"
      camposExtras={[
        {
          chave: "categoriaId",
          label: "Categoria",
          tipo: "select",
          obrigatorio: true,
          opcoes: data.dominios.categoriasProdutoPapelaria.map((c) => ({ value: c.id, label: c.nome })),
        },
        {
          chave: "unidadeMedidaPadrao",
          label: "Unidade de medida padrão",
          tipo: "select",
          obrigatorio: true,
          opcoes: Object.entries(UNIDADE_MEDIDA_PRODUTO_LABEL).map(([k, v]) => ({ value: k, label: v })),
          valorPadrao: "UNIDADE",
        },
      ]}
      valoresIniciaisExtras={(item) => ({ categoriaId: item.categoriaId, unidadeMedidaPadrao: item.unidadeMedidaPadrao })}
      renderDetalhe={(item) => (
        <>
          {item.categoria?.nome || data.dominios.categoriasProdutoPapelaria.find((c) => c.id === item.categoriaId)?.nome || "—"}
          {" · "}{UNIDADE_MEDIDA_PRODUTO_LABEL[item.unidadeMedidaPadrao]}
        </>
      )}
      onAlternarStatus={async (id, atual) => { await dominiosApi.atualizarProdutoPapelaria(id, { status: atual === "ATIVO" ? "INATIVO" : "ATIVO" }); await onChanged(); }}
      onCriar={async (nome, extras) => {
        await dominiosApi.criarProdutoPapelaria({ nome, categoriaId: extras.categoriaId, unidadeMedidaPadrao: extras.unidadeMedidaPadrao as UnidadeMedidaProduto });
        await onChanged();
      }}
      onRenomear={async (id, nome, extras) => {
        await dominiosApi.atualizarProdutoPapelaria(id, { nome, categoriaId: extras.categoriaId, unidadeMedidaPadrao: extras.unidadeMedidaPadrao as UnidadeMedidaProduto });
        await onChanged();
      }}
      // Seguro por definição: produtoId em ItemSolicitacaoPapelaria é ON
      // DELETE SET NULL (o item mantém o snapshot nomeProduto/categoriaId) —
      // excluir um produto do catálogo nunca deixa uma solicitação já feita
      // inconsistente.
      onExcluir={async (id) => { await dominiosApi.removerProdutoPapelaria(id); await onChanged(); }}
      mensagemCriado="Produto cadastrado."
      mensagemAtualizado="Produto atualizado."
      mensagemExcluido="Produto excluído."
      mensagemErroEdicao="Não foi possível salvar as alterações."
    />
  );
}

function CategoriasProdutoEquipamentoBlock({ data, onChanged }: Props) {
  return (
    <ListaSimplesBlock
      titulo="Categorias de Produto (Equipamento)"
      itens={data.dominios.categoriasProdutoEquipamento}
      novoLabel="Nova Categoria"
      campoLabel="Nome da categoria"
      onCriar={async (nome) => { await dominiosApi.criarCategoriaProdutoEquipamento(nome); await onChanged(); }}
      onAlternarStatus={async (id, atual) => { await dominiosApi.atualizarCategoriaProdutoEquipamento(id, { status: atual === "ATIVO" ? "INATIVO" : "ATIVO" }); await onChanged(); }}
      onRenomear={async (id, nome) => { await dominiosApi.atualizarCategoriaProdutoEquipamento(id, { nome }); await onChanged(); }}
      onExcluir={async (id) => { await dominiosApi.removerCategoriaProdutoEquipamento(id); await onChanged(); }}
    />
  );
}

// Produtos de Equipamento precisam de uma Categoria vinculada (obrigatória),
// mesmo racional de ProdutosPapelariaBlock acima — só sem o campo de
// unidade de medida (não existe nesse catálogo, ver comentário no schema).
function ProdutosEquipamentoBlock({ data, onChanged }: Props) {
  const { sucesso } = useFeedback();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");
  const [categoriaEdicao, setCategoriaEdicao] = useState("");

  async function salvar() {
    if (!nome.trim() || !categoriaId) return;
    setSalvando(true);
    setErro(null);
    try {
      await dominiosApi.criarProdutoEquipamento({ nome: nome.trim(), categoriaId });
      await onChanged();
      setNome("");
      setCategoriaId("");
      setCriando(false);
      sucesso("Produto cadastrado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus(id: string, statusAtual: "ATIVO" | "INATIVO") {
    setPendente(id);
    try {
      await dominiosApi.atualizarProdutoEquipamento(id, { status: statusAtual === "ATIVO" ? "INATIVO" : "ATIVO" });
      await onChanged();
      sucesso("Status atualizado.");
    } finally {
      setPendente(null);
    }
  }

  async function salvarEdicao(id: string) {
    if (!nomeEdicao.trim() || !categoriaEdicao) return;
    setPendente(id);
    setErro(null);
    try {
      await dominiosApi.atualizarProdutoEquipamento(id, { nome: nomeEdicao.trim(), categoriaId: categoriaEdicao });
      await onChanged();
      setEditandoId(null);
      sucesso("Produto atualizado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar as alterações.");
    } finally {
      setPendente(null);
    }
  }

  // Seguro por definição: produtoId em SolicitacaoEquipamento é ON DELETE
  // SET NULL (a solicitação mantém o snapshot em `item`) — excluir um
  // produto do catálogo nunca deixa uma solicitação já feita inconsistente.
  async function excluir(id: string) {
    setPendente(id);
    setErro(null);
    try {
      await dominiosApi.removerProdutoEquipamento(id);
      await onChanged();
      setConfirmandoExcluir(null);
      sucesso("Produto excluído.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setPendente(null);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Produtos de Equipamento</h3>
        <Button variant="accent" onClick={() => setCriando(true)}>
          <Plus size={16} /> Novo Produto
        </Button>
      </div>

      {criando && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg">
          {erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
          <Field label="Nome do produto">
            <TextInput value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </Field>
          <Field label="Categoria">
            <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">—</option>
              {data.dominios.categoriasProdutoEquipamento.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => { setCriando(false); setNome(""); setCategoriaId(""); }}>Cancelar</Button>
            <Button variant="primary" onClick={salvar} disabled={!nome.trim() || !categoriaId || salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {!criando && erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {data.dominios.produtosEquipamento.map((p) => (
          <div key={p.id} className="text-sm py-1.5 border-b border-gray-100 last:border-0">
            {editandoId === p.id ? (
              <div className="space-y-1.5 py-1">
                <TextInput value={nomeEdicao} onChange={(e) => setNomeEdicao(e.target.value)} autoFocus placeholder="Nome do produto" className="!py-1 !text-sm" />
                <Select value={categoriaEdicao} onChange={(e) => setCategoriaEdicao(e.target.value)} className="!py-1 !text-sm">
                  {data.dominios.categoriasProdutoEquipamento.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </Select>
                <div className="flex items-center gap-1.5">
                  <button className="text-brand-700 dark:text-brand-400 font-semibold text-xs whitespace-nowrap" disabled={pendente === p.id || !nomeEdicao.trim() || !categoriaEdicao} onClick={() => salvarEdicao(p.id)}>salvar</button>
                  <button className="text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap" onClick={() => setEditandoId(null)}>cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={p.status === "INATIVO" ? "text-gray-400 dark:text-slate-500 line-through" : "text-slate-800"}>{p.nome}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 truncate">
                    {p.categoria?.nome || data.dominios.categoriasProdutoEquipamento.find((c) => c.id === p.categoriaId)?.nome || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => alternarStatus(p.id, p.status)} disabled={pendente === p.id} className="disabled:opacity-50" title="Clique para ativar/inativar">
                    <Stamp tone={p.status === "ATIVO" ? "pos" : "neg"}>{p.status === "ATIVO" ? "Ativo" : "Inativo"}</Stamp>
                  </button>
                  <button
                    className="text-gray-500 dark:text-slate-400 hover:text-brand-600"
                    title="Editar"
                    aria-label={`Editar produto ${p.nome}`}
                    onClick={() => { setEditandoId(p.id); setNomeEdicao(p.nome); setCategoriaEdicao(p.categoriaId); }}
                  >
                    <Pencil size={12} />
                  </button>
                  {confirmandoExcluir === p.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <button className="text-brand-700 dark:text-brand-400 font-semibold" disabled={pendente === p.id} onClick={() => excluir(p.id)}>confirmar</button>
                      <button className="text-gray-500 dark:text-slate-400" onClick={() => setConfirmandoExcluir(null)}>cancelar</button>
                    </span>
                  ) : (
                    <button className="text-gray-500 dark:text-slate-400 hover:text-brand-600 text-xs" title="Excluir definitivamente" onClick={() => setConfirmandoExcluir(p.id)}>
                      excluir
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {data.dominios.produtosEquipamento.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum produto cadastrado ainda.</p>}
      </div>
    </div>
  );
}

// Acessórios de Equipamento (17/07/2026, pedido do Vini: "colocar se vem com
// acessório ou não... cada categoria tem que ter seus acessório próprios")
// — mesmo molde de ProdutosEquipamentoBlock acima (Categoria obrigatória +
// nome), só que vinculado a CategoriaEquipamento (Notebook/Celular/Monitor
// etc., a mesma lista do formulário de cadastro de Equipamento) em vez de
// CategoriaProdutoEquipamento (catálogo do módulo de Solicitações, uma lista
// separada). nome é único por categoria, não globalmente — "Carregador" pode
// existir tanto em Notebook quanto em Celular como cadastros independentes
// (ver @@unique([nome, categoriaId]) no schema); o backend recusa duplicata
// só dentro da mesma categoria.
function AcessoriosEquipamentoBlock({ data, onChanged }: Props) {
  const { sucesso } = useFeedback();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");
  const [categoriaEdicao, setCategoriaEdicao] = useState("");

  async function salvar() {
    if (!nome.trim() || !categoriaId) return;
    setSalvando(true);
    setErro(null);
    try {
      await dominiosApi.criarAcessorioEquipamento({ nome: nome.trim(), categoriaId });
      await onChanged();
      setNome("");
      setCategoriaId("");
      setCriando(false);
      sucesso("Acessório cadastrado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus(id: string, statusAtual: "ATIVO" | "INATIVO") {
    setPendente(id);
    try {
      await dominiosApi.atualizarAcessorioEquipamento(id, { status: statusAtual === "ATIVO" ? "INATIVO" : "ATIVO" });
      await onChanged();
      sucesso("Status atualizado.");
    } finally {
      setPendente(null);
    }
  }

  async function salvarEdicao(id: string) {
    if (!nomeEdicao.trim() || !categoriaEdicao) return;
    setPendente(id);
    setErro(null);
    try {
      await dominiosApi.atualizarAcessorioEquipamento(id, { nome: nomeEdicao.trim(), categoriaId: categoriaEdicao });
      await onChanged();
      setEditandoId(null);
      sucesso("Acessório atualizado.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar as alterações.");
    } finally {
      setPendente(null);
    }
  }

  // Diferente de ProdutoEquipamento: aqui o backend BLOQUEIA a exclusão
  // (409) enquanto algum equipamento ainda tiver esse acessório vinculado
  // (EquipamentoAcessorio → AcessorioEquipamento é ON DELETE RESTRICT, não
  // SET NULL) — a mensagem de erro do backend já orienta a desvincular ou
  // simplesmente inativar em vez de excluir.
  async function excluir(id: string) {
    setPendente(id);
    setErro(null);
    try {
      await dominiosApi.removerAcessorioEquipamento(id);
      await onChanged();
      setConfirmandoExcluir(null);
      sucesso("Acessório excluído.");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível excluir.");
    } finally {
      setPendente(null);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 rounded-[var(--radius-card)] shadow-[var(--elevation-1)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Acessórios de Equipamento</h3>
        <Button variant="accent" onClick={() => setCriando(true)}>
          <Plus size={16} /> Novo Acessório
        </Button>
      </div>

      {criando && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg">
          {erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}
          <Field label="Nome do acessório">
            <TextInput value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Carregador, Mouse, Capa" autoFocus />
          </Field>
          <Field label="Categoria">
            <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">—</option>
              {data.dominios.categoriasEquipamento.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => { setCriando(false); setNome(""); setCategoriaId(""); }}>Cancelar</Button>
            <Button variant="primary" onClick={salvar} disabled={!nome.trim() || !categoriaId || salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {!criando && erro && <div className="mb-2 text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-lg p-2">{erro}</div>}

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {data.dominios.acessoriosEquipamento.map((a) => (
          <div key={a.id} className="text-sm py-1.5 border-b border-gray-100 last:border-0">
            {editandoId === a.id ? (
              <div className="space-y-1.5 py-1">
                <TextInput value={nomeEdicao} onChange={(e) => setNomeEdicao(e.target.value)} autoFocus placeholder="Nome do acessório" className="!py-1 !text-sm" />
                <Select value={categoriaEdicao} onChange={(e) => setCategoriaEdicao(e.target.value)} className="!py-1 !text-sm">
                  {data.dominios.categoriasEquipamento.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </Select>
                <div className="flex items-center gap-1.5">
                  <button className="text-brand-700 dark:text-brand-400 font-semibold text-xs whitespace-nowrap" disabled={pendente === a.id || !nomeEdicao.trim() || !categoriaEdicao} onClick={() => salvarEdicao(a.id)}>salvar</button>
                  <button className="text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap" onClick={() => setEditandoId(null)}>cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={a.status === "INATIVO" ? "text-gray-400 dark:text-slate-500 line-through" : "text-slate-800"}>{a.nome}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 truncate">
                    {a.categoria?.nome || data.dominios.categoriasEquipamento.find((c) => c.id === a.categoriaId)?.nome || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => alternarStatus(a.id, a.status)} disabled={pendente === a.id} className="disabled:opacity-50" title="Clique para ativar/inativar">
                    <Stamp tone={a.status === "ATIVO" ? "pos" : "neg"}>{a.status === "ATIVO" ? "Ativo" : "Inativo"}</Stamp>
                  </button>
                  <button
                    className="text-gray-500 dark:text-slate-400 hover:text-brand-600"
                    title="Editar"
                    aria-label={`Editar acessório ${a.nome}`}
                    onClick={() => { setEditandoId(a.id); setNomeEdicao(a.nome); setCategoriaEdicao(a.categoriaId); }}
                  >
                    <Pencil size={12} />
                  </button>
                  {confirmandoExcluir === a.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <button className="text-brand-700 dark:text-brand-400 font-semibold" disabled={pendente === a.id} onClick={() => excluir(a.id)}>confirmar</button>
                      <button className="text-gray-500 dark:text-slate-400" onClick={() => setConfirmandoExcluir(null)}>cancelar</button>
                    </span>
                  ) : (
                    <button className="text-gray-500 dark:text-slate-400 hover:text-brand-600 text-xs" title="Excluir definitivamente" onClick={() => setConfirmandoExcluir(a.id)}>
                      excluir
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {data.dominios.acessoriosEquipamento.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">Nenhum acessório cadastrado ainda.</p>}
      </div>
    </div>
  );
}
