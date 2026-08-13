// Tipos alinhados 1:1 com prisma/schema.prisma do backend
// (administrar-imoveis-backend). Enums do banco usam valores em
// MAIÚSCULAS_COM_UNDERSCORE; os mapas de rótulo abaixo traduzem para o
// português natural usado na interface (ex: "Em uso", "Em análise").

// RH (08/07/2026, pedido do Vini) — só enxerga Visão Geral + Colaboradores no
// AppShell (ver NAV em App.tsx), somente leitura (colaboradoresReadOnly em
// App.tsx já cobre isso automaticamente por não estar na lista de papéis com
// edição), mas com CPF/data de nascimento/termo sem máscara — ver
// PAPEIS_COM_CPF_COMPLETO no backend.
//
// FINANCEIRO (17/07/2026, pedido do Vini: "falta um financeiro para aprovar
// as solicitações de equipamentos, solicitações de papelaria e compras") —
// papel novo, função única: aprovação de custo (ver
// PAPEIS_QUE_APROVAM/PAPEIS_GERENCIAM no backend). Reorganização de
// hierarquia no mesmo pedido: GESTOR_COORDENADOR deixou de aprovar
// equipamento/papelaria — identidade nova é gestão do ciclo de vida de
// pessoas (Colaboradores, desligamento, Movimentações), não patrimônio nem
// aprovação de custo. Ver NAV em App.tsx para o mapa completo por papel.
// MARKETING (13/08/2026, pedido do Vini) — papel novo, dono do módulo de
// Marketing Imobiliário (Banco de Imóveis + integração Imoview). Mesmo
// racional de RH/FINANCEIRO acima: só o item "Imóveis" no próprio NAV (ver
// App.tsx) — sem Equipamentos/Linhas/Acessos/Chamados (não é patrimônio nem
// suporte), sem Colaboradores (não é gestão de pessoas).
export type Papel = "ADMINISTRADOR" | "GESTOR_COORDENADOR" | "SUPORTE_TI" | "COLABORADOR" | "RH" | "FINANCEIRO" | "MARKETING";

export const PAPEL_LABEL: Record<Papel, string> = {
  ADMINISTRADOR: "Administrador Geral",
  GESTOR_COORDENADOR: "Gestor / Coordenador",
  SUPORTE_TI: "Suporte / TI",
  COLABORADOR: "Colaborador (Portal)",
  RH: "RH",
  FINANCEIRO: "Financeiro",
  MARKETING: "Marketing",
};

// EM_AVISO (09/07/2026, pedido do Vini) — colaborador em aviso prévio: ainda
// vinculado e trabalhando, mas com desligamento já encaminhado. Ver
// colaboradorOperacionalmenteAtivo() abaixo — tratado como ativo pra fins de
// seletor de responsável (equipamento/chamado/solicitação) e pro KPI do
// painel, só muda o rótulo/selo.
export type StatusColaborador = "ATIVO" | "INATIVO" | "AFASTADO" | "EM_AVISO";
export const STATUS_COLABORADOR_LABEL: Record<StatusColaborador, string> = {
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  AFASTADO: "Afastado",
  EM_AVISO: "Em aviso",
};
// Tom explícito (28/07/2026, achado do Vini: "alguns lugares que deviam
// estar com a cor verde, amarela, vermelha, está só amarelo... revisa todos
// esses ícones"). Causa raiz, igual à já documentada em STATUS_PAGAMENTO_TONE
// acima: sem `tone` explícito, <Stamp> deduz a cor tentando casar o rótulo
// contra as listas genéricas POSITIVOS/NEGATIVOS (ver `tone()` abaixo) — só
// "Ativo"/"Inativo" batem por coincidência; "Afastado"/"Em aviso" caem no
// amarelo padrão sempre, mesmo não sendo essa a intenção em toda tela.
// Auditoria completa (28/07/2026) encontrou o mesmo padrão em quase todo
// domínio do sistema — este é o primeiro de vários mapas *_TONE novos
// adicionados nesta mesma auditoria.
export const STATUS_COLABORADOR_TONE: Record<StatusColaborador, "pos" | "neg" | "pend"> = {
  ATIVO: "pos",
  INATIVO: "neg",
  AFASTADO: "pend",
  EM_AVISO: "pend",
};

// Pra seletores de responsável (equipamento/chamado/solicitação) e o KPI
// "Colaboradores ativos" do painel — colaborador em aviso prévio continua
// trabalhando normalmente até o desligamento, então continua contando.
export function colaboradorOperacionalmenteAtivo(status: StatusColaborador): boolean {
  return status === "ATIVO" || status === "EM_AVISO";
}

export type EstadoConservacao = "NOVO" | "BOM" | "REGULAR" | "DANIFICADO";
export const ESTADO_CONSERVACAO_LABEL: Record<EstadoConservacao, string> = {
  NOVO: "Novo",
  BOM: "Bom",
  REGULAR: "Regular",
  DANIFICADO: "Danificado",
};

// EMPRESTADO/PERDIDO/DESCARTADO adicionados na Evolução Completa (07/2026) —
// situações que já existiam na prática mas não tinham status dedicado antes.
export type StatusEquipamento =
  | "EM_USO" | "DISPONIVEL" | "EM_MANUTENCAO" | "BAIXADO"
  | "EMPRESTADO" | "PERDIDO" | "DESCARTADO";
export const STATUS_EQUIPAMENTO_LABEL: Record<StatusEquipamento, string> = {
  EM_USO: "Em uso",
  DISPONIVEL: "Disponível",
  EM_MANUTENCAO: "Em manutenção",
  BAIXADO: "Baixado",
  EMPRESTADO: "Emprestado",
  PERDIDO: "Perdido",
  DESCARTADO: "Descartado",
};
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
export const STATUS_EQUIPAMENTO_TONE: Record<StatusEquipamento, "pos" | "neg" | "pend"> = {
  EM_USO: "pos",
  DISPONIVEL: "pos",
  EM_MANUTENCAO: "pend",
  EMPRESTADO: "pend",
  BAIXADO: "neg",
  PERDIDO: "neg",
  DESCARTADO: "neg",
};

export type StatusLinha = "ATIVA" | "DISPONIVEL" | "CANCELADA" | "BLOQUEADA";
export const STATUS_LINHA_LABEL: Record<StatusLinha, string> = {
  ATIVA: "Ativa",
  DISPONIVEL: "Disponível",
  CANCELADA: "Cancelada",
  BLOQUEADA: "Bloqueada",
};
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
export const STATUS_LINHA_TONE: Record<StatusLinha, "pos" | "neg" | "pend"> = {
  ATIVA: "pos",
  DISPONIVEL: "pos",
  CANCELADA: "neg",
  BLOQUEADA: "neg",
};

// Novo na Evolução Completa: toda linha existente até 07/2026 nasce
// classificada como Pós-paga (default do backend); a partir daqui novas
// linhas podem ser cadastradas como Pré-pagas.
export type TipoPlano = "POS_PAGO" | "PRE_PAGO";
export const TIPO_PLANO_LABEL: Record<TipoPlano, string> = {
  POS_PAGO: "Pós-pago",
  PRE_PAGO: "Pré-pago",
};

// Etapa 1 (08/07/2026, pedido do Vini — Reestruturação e Sincronização das
// Linhas Telefônicas). Espelha a coluna "Situação Conferência" que já
// existia na planilha organizacional, agora como campo de verdade.
export type SituacaoConferenciaLinha = "NAO_VERIFICADO" | "CONFERIDO" | "NECESSITA_CONFERENCIA";
export const SITUACAO_CONFERENCIA_LABEL: Record<SituacaoConferenciaLinha, string> = {
  NAO_VERIFICADO: "Não verificado",
  CONFERIDO: "Conferido",
  NECESSITA_CONFERENCIA: "Necessita conferência",
};

export type StatusAcesso = "ATIVO" | "BLOQUEADO" | "PENDENTE_CRIACAO" | "REVOGADO";
export const STATUS_ACESSO_LABEL: Record<StatusAcesso, string> = {
  ATIVO: "Ativo",
  BLOQUEADO: "Bloqueado",
  PENDENTE_CRIACAO: "Pendente de criação",
  REVOGADO: "Revogado",
};
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
export const STATUS_ACESSO_TONE: Record<StatusAcesso, "pos" | "neg" | "pend"> = {
  ATIVO: "pos",
  BLOQUEADO: "neg",
  PENDENTE_CRIACAO: "pend",
  REVOGADO: "neg",
};

export type StatusLote = "ABERTO" | "FECHADO";
export const STATUS_LOTE_LABEL: Record<StatusLote, string> = { ABERTO: "Aberto", FECHADO: "Fechado" };

export type Prioridade = "ALTA" | "MEDIA" | "BAIXA";
export const PRIORIDADE_LABEL: Record<Prioridade, string> = { ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" };
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
// "Alta"/"Média"/"Baixa" não batem com nenhuma das listas genéricas
// POSITIVOS/NEGATIVOS, então TODA prioridade (inclusive Alta, urgente) saía
// amarela sem diferenciação — provavelmente a principal causa do relato do
// Vini ("alguns lugares... está só amarelo"), já que prioridade aparece em
// praticamente todo cartão de Chamado e Solicitação. Prioridade Alta = ruim
// (vermelho, precisa de atenção urgente), Baixa = bom (verde, sem pressa).
export const PRIORIDADE_TONE: Record<Prioridade, "pos" | "neg" | "pend"> = {
  ALTA: "neg",
  MEDIA: "pend",
  BAIXA: "pos",
};

export type StatusSolicitacao =
  | "PENDENTE" | "EM_ANALISE" | "APROVADO" | "EM_COMPRA" | "COMPRADO" | "ENTREGUE" | "CANCELADO" | "REPROVADO";
export const STATUS_SOLICITACAO_LABEL: Record<StatusSolicitacao, string> = {
  PENDENTE: "Pendente",
  EM_ANALISE: "Em análise",
  APROVADO: "Aprovado",
  EM_COMPRA: "Em compra",
  COMPRADO: "Comprado",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
  REPROVADO: "Reprovado",
};
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
// Este mapa por acaso já batia quase todo certo por coincidência com as
// listas genéricas (ver `tone()`), mas deixa explícito por consistência e
// pra não depender de coincidência de texto no futuro.
export const STATUS_SOLICITACAO_TONE: Record<StatusSolicitacao, "pos" | "neg" | "pend"> = {
  PENDENTE: "pend",
  EM_ANALISE: "pend",
  APROVADO: "pos",
  EM_COMPRA: "pend",
  COMPRADO: "pos",
  ENTREGUE: "pos",
  CANCELADO: "neg",
  REPROVADO: "neg",
};
export const SOLIC_STATUSES: StatusSolicitacao[] = [
  "PENDENTE", "EM_ANALISE", "APROVADO", "EM_COMPRA", "COMPRADO", "ENTREGUE", "CANCELADO", "REPROVADO",
];

// ---------------------------------------------------------------------------
// Papelaria e Compras (09/07/2026, pedido do Vini) — submódulo de
// Solicitações que vive ao lado de Solicitação de Equipamento acima, dentro
// da mesma aba "Solicitações" (ver SolicitacoesHub.tsx). Mesmo racional de
// linha do tempo de eventos do Chamado de Manutenção (ver TipoEventoChamado/
// ChamadoEvento abaixo): toda mudança de status, edição e comentário vira um
// EventoSolicitacaoPapelaria, nunca uma alteração muda/silenciosa.
export type TipoSolicitacaoPapelaria = "MENSAL" | "AVULSA";
export const TIPO_SOLICITACAO_PAPELARIA_LABEL: Record<TipoSolicitacaoPapelaria, string> = {
  MENSAL: "Mensal",
  AVULSA: "Avulsa/Urgente",
};

export type StatusSolicitacaoPapelaria =
  | "RASCUNHO" | "ENVIADA" | "EM_ANALISE" | "APROVADA" | "EM_SEPARACAO"
  | "EM_TRANSPORTE" | "ENTREGUE" | "CANCELADA" | "REPROVADA";
export const STATUS_SOLICITACAO_PAPELARIA_LABEL: Record<StatusSolicitacaoPapelaria, string> = {
  RASCUNHO: "Rascunho",
  ENVIADA: "Enviada",
  EM_ANALISE: "Em análise",
  APROVADA: "Aprovada",
  EM_SEPARACAO: "Em separação",
  EM_TRANSPORTE: "Em transporte",
  ENTREGUE: "Entregue",
  CANCELADA: "Cancelada",
  REPROVADA: "Reprovada",
};
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
export const STATUS_SOLICITACAO_PAPELARIA_TONE: Record<StatusSolicitacaoPapelaria, "pos" | "neg" | "pend"> = {
  RASCUNHO: "pend",
  ENVIADA: "pend",
  EM_ANALISE: "pend",
  APROVADA: "pos",
  EM_SEPARACAO: "pend",
  EM_TRANSPORTE: "pend",
  ENTREGUE: "pos",
  CANCELADA: "neg",
  REPROVADA: "neg",
};
// Achado ao construir o módulo (09/07/2026): CHAM_STATUSES/SOLIC_STATUSES
// acima já estabelecem a convenção do sistema — todo status, inclusive os
// terminais/exceção (ENCERRADO, CANCELADO, REPROVADO), vira uma coluna real
// do Kanban, nunca fica escondido atrás de um filtro. Papelaria segue a
// mesma convenção por consistência entre os 3 quadros Kanban do sistema.
export const SOLIC_PAPELARIA_STATUSES: StatusSolicitacaoPapelaria[] = [
  "RASCUNHO", "ENVIADA", "EM_ANALISE", "APROVADA", "EM_SEPARACAO", "EM_TRANSPORTE", "ENTREGUE", "CANCELADA", "REPROVADA",
];

// Espelha TRANSICOES_VALIDAS de solicitacoesPapelaria.routes.ts — usado só
// para decidir quais opções oferecer no seletor de "Mudar status"/Kanban da
// UI; o backend continua sendo a fonte de verdade e recusa (409) qualquer
// transição fora desta lista de qualquer forma.
export const TRANSICOES_SOLIC_PAPELARIA: Record<StatusSolicitacaoPapelaria, StatusSolicitacaoPapelaria[]> = {
  RASCUNHO: ["ENVIADA", "CANCELADA"],
  ENVIADA: ["EM_ANALISE", "APROVADA", "REPROVADA", "CANCELADA"],
  EM_ANALISE: ["APROVADA", "REPROVADA", "CANCELADA"],
  APROVADA: ["EM_SEPARACAO", "CANCELADA"],
  EM_SEPARACAO: ["EM_TRANSPORTE", "CANCELADA"],
  EM_TRANSPORTE: ["ENTREGUE", "CANCELADA"],
  ENTREGUE: [],
  CANCELADA: [],
  REPROVADA: [],
};
// Só estas duas transições representam decisão de aprovação (o backend
// preenche aprovadorId nelas) — usado pra UI oferecer botões dedicados
// "Aprovar"/"Reprovar" em vez de um "Mudar status" genérico, mesmo tratamento
// que Solicitacoes.tsx já dá pra APROVADO/REPROVADO do módulo de Equipamento.
export const STATUS_PAPELARIA_DECISAO: StatusSolicitacaoPapelaria[] = ["APROVADA", "REPROVADA"];

export type TipoEventoSolicitacaoPapelaria = "CRIACAO" | "EDICAO" | "MUDANCA_STATUS" | "COMENTARIO";

export type UnidadeMedidaProduto =
  | "UNIDADE" | "PACOTE" | "CAIXA" | "RESMA" | "FRASCO" | "ROLO" | "PAR" | "KIT" | "GALAO" | "OUTRO";
export const UNIDADE_MEDIDA_PRODUTO_LABEL: Record<UnidadeMedidaProduto, string> = {
  UNIDADE: "Unidade",
  PACOTE: "Pacote",
  CAIXA: "Caixa",
  RESMA: "Resma",
  FRASCO: "Frasco",
  ROLO: "Rolo",
  PAR: "Par",
  KIT: "Kit",
  GALAO: "Galão",
  OUTRO: "Outro",
};

// ---------------------------------------------------------------------------
// Central de Notificações (Fase B, 09/07/2026, pedido do Vini) — o backend já
// resolve `titulo`/`mensagem` prontos em pt-BR na hora de criar cada
// notificação (ver notificacoes.service.ts), então o frontend não precisa de
// um mapa tipo->texto: só exibe o que veio pronto. Só a categoria (usada nos
// filtros/ícones do painel) e a prioridade (já reaproveitando Prioridade
// acima) precisam de label aqui.
// FINANCEIRO (22/07/2026, pedido do Vini) — criada pro estorno de pagamento;
// antes disso não existia categoria pro módulo de Pagamentos.
export type CategoriaNotificacao =
  | "CHAMADO" | "SOLICITACAO_EQUIPAMENTO" | "SOLICITACAO_PAPELARIA" | "PATRIMONIO"
  | "LINHA_TELEFONICA" | "USUARIO" | "MENSAGEM" | "SISTEMA" | "FINANCEIRO" | "DOCUMENTO";
export const CATEGORIA_NOTIFICACAO_LABEL: Record<CategoriaNotificacao, string> = {
  CHAMADO: "Chamados",
  SOLICITACAO_EQUIPAMENTO: "Solicitação de equipamento",
  SOLICITACAO_PAPELARIA: "Papelaria e compras",
  PATRIMONIO: "Patrimônio",
  LINHA_TELEFONICA: "Linhas telefônicas",
  USUARIO: "Usuários",
  MENSAGEM: "Mensagens",
  SISTEMA: "Sistema",
  FINANCEIRO: "Financeiro",
  DOCUMENTO: "Documentos (RH)",
};

export interface Notificacao {
  id: string;
  destinatarioId: string;
  origemUsuarioId: string | null;
  categoria: CategoriaNotificacao;
  tipo: string;
  titulo: string;
  mensagem: string;
  prioridade: Prioridade;
  entidade: string | null;
  entidadeId: string | null;
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
}

export interface PreferenciaNotificacao {
  usuarioId: string;
  categoriasSilenciadas: CategoriaNotificacao[];
  prioridadeMinima: Prioridade;
  som: boolean;
  notificacaoNavegador: boolean;
  atualizadoEm?: string;
}

// Categorias e status reescritos na Evolução Completa Fase 2 (07/2026) —
// substituem o conjunto antigo por completo (ver schema.prisma do backend
// para o mapeamento usado na migração dos chamados que já existiam).
export type CategoriaChamado =
  | "MANUTENCAO" | "SOLICITACAO_EQUIPAMENTO" | "SOFTWARE" | "HARDWARE"
  | "REDE" | "TELEFONIA" | "IMPRESSORA" | "ACESSOS" | "IMOVIEW_CRM" | "OUTROS";
export const CATEGORIA_CHAMADO_LABEL: Record<CategoriaChamado, string> = {
  MANUTENCAO: "Manutenção",
  SOLICITACAO_EQUIPAMENTO: "Solicitação de equipamento",
  SOFTWARE: "Software",
  HARDWARE: "Hardware",
  REDE: "Rede",
  TELEFONIA: "Telefonia",
  IMPRESSORA: "Impressora",
  ACESSOS: "Acessos",
  IMOVIEW_CRM: "Imoview CRM",
  OUTROS: "Outros",
};
export const CATEGORIAS_CHAMADO: CategoriaChamado[] = [
  "MANUTENCAO", "SOLICITACAO_EQUIPAMENTO", "SOFTWARE", "HARDWARE",
  "REDE", "TELEFONIA", "IMPRESSORA", "ACESSOS", "IMOVIEW_CRM", "OUTROS",
];

// Categorias oferecidas ao ABRIR um chamado NOVO (22/07/2026, achado do
// Vini: "quando vai em suporte técnico tem opção de solicitar equipamento,
// mas já tem a parte individual para pedir equipamento" — duplicação real).
// O sistema já tem um fluxo próprio e completo pra pedir equipamento —
// SolicitacaoEquipamento, com validação técnica + aprovação de custo em
// duas etapas (ver comentário em solicitacoes.routes.ts no backend) — e o
// próprio Portal do Colaborador já direciona pra ele certo, através do
// modal de escolha guiada "Nova Solicitação" (ver EscolhaTipoSolicitacaoModal
// em PortalColaborador.tsx). Mas o formulário de "Abrir Chamado" (Suporte
// Técnico) também oferecia "Solicitação de equipamento" como categoria —
// um SEGUNDO caminho pro mesmo pedido, só que virando um Chamado comum, sem
// nenhuma etapa de aprovação de custo. Resultado prático: um pedido de
// equipamento aberto por aqui nunca passava pelo Financeiro, ficando só na
// fila geral de Suporte — inconsistente com todo pedido feito pelo caminho
// certo. Por isso "SOLICITACAO_EQUIPAMENTO" fica de fora da lista usada nos
// formulários de CRIAÇÃO (Chamados.tsx e PortalColaborador.tsx), mas
// continua em CATEGORIAS_CHAMADO pra tudo que já existe (rótulo, filtro,
// estatística) e pra edição de um chamado já aberto (ChamadoDetalhe.tsx,
// onde reclassificar um ticket antigo continua fazendo sentido).
export const CATEGORIAS_CHAMADO_CRIAVEIS: CategoriaChamado[] = CATEGORIAS_CHAMADO.filter(
  (c) => c !== "SOLICITACAO_EQUIPAMENTO"
);

// Centralização de Todo o Suporte (09/07/2026, pedido do Vini) — campos
// dinâmicos exclusivos da categoria IMOVIEW_CRM (ver comentário equivalente
// em schema.prisma no backend). `codigoImovel` só é obrigatório quando o
// tipo é PROBLEMA_IMOVEL — ver faltaObrigatorio nos formulários que usam isto.
export type TipoSolicitacaoImoview =
  | "ERRO_BUG" | "DUVIDA" | "LENTIDAO" | "SOLICITACAO_ACESSO"
  | "SOLICITACAO_MELHORIA" | "PROBLEMA_IMOVEL" | "OUTRO";
export const TIPO_SOLICITACAO_IMOVIEW_LABEL: Record<TipoSolicitacaoImoview, string> = {
  ERRO_BUG: "Erro/Bug",
  DUVIDA: "Dúvida",
  LENTIDAO: "Lentidão",
  SOLICITACAO_ACESSO: "Solicitação de acesso",
  SOLICITACAO_MELHORIA: "Solicitação de melhoria",
  PROBLEMA_IMOVEL: "Problema relacionado a imóvel",
  OUTRO: "Outro",
};
export const TIPOS_SOLICITACAO_IMOVIEW: TipoSolicitacaoImoview[] = [
  "ERRO_BUG", "DUVIDA", "LENTIDAO", "SOLICITACAO_ACESSO", "SOLICITACAO_MELHORIA", "PROBLEMA_IMOVEL", "OUTRO",
];

export type StatusChamado =
  | "ABERTO" | "EM_ANALISE" | "EM_ANDAMENTO" | "AGUARDANDO_COLABORADOR"
  | "AGUARDANDO_PECA" | "RESOLVIDO" | "ENCERRADO";
export const STATUS_CHAMADO_LABEL: Record<StatusChamado, string> = {
  ABERTO: "Aberto",
  EM_ANALISE: "Em análise",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_COLABORADOR: "Aguardando colaborador",
  AGUARDANDO_PECA: "Aguardando peça",
  RESOLVIDO: "Resolvido",
  ENCERRADO: "Encerrado",
};
// Tom explícito (28/07/2026, achado do Vini: "o chamado que tá em aberto,
// que tá resolvido, não fica vermelho, não fica verde, fica da mesma cor")
// — ver comentário completo em STATUS_COLABORADOR_TONE. Causa raiz exata
// deste caso: "Resolvido" batia com POSITIVOS (auto-detecção acidental) mas
// "Encerrado" não batia com nada — os dois status "terminados" de um
// chamado saíam com cores diferentes entre si (um verde, outro amarelo) sem
// motivo real, e nenhum status aberto/em andamento nunca tinha chance de
// ficar vermelho. Agora ambos os terminais ficam verdes e nada mais depende
// de coincidência de texto.
export const STATUS_CHAMADO_TONE: Record<StatusChamado, "pos" | "neg" | "pend"> = {
  ABERTO: "pend",
  EM_ANALISE: "pend",
  EM_ANDAMENTO: "pend",
  AGUARDANDO_COLABORADOR: "pend",
  AGUARDANDO_PECA: "pend",
  RESOLVIDO: "pos",
  ENCERRADO: "pos",
};
export const CHAM_STATUSES: StatusChamado[] = [
  "ABERTO", "EM_ANALISE", "EM_ANDAMENTO", "AGUARDANDO_COLABORADOR", "AGUARDANDO_PECA", "RESOLVIDO", "ENCERRADO",
];

// Fase 2 — Melhorias Estruturais (09/07/2026): REABERTURA e AVALIACAO
// somaram-se aos tipos de evento já existentes — ver comentário equivalente
// em schema.prisma no backend.
export type TipoEventoChamado =
  | "ABERTURA" | "MENSAGEM" | "MUDANCA_STATUS" | "ATRIBUICAO" | "ATUALIZACAO" | "ANEXO"
  | "REABERTURA" | "AVALIACAO";

export type TipoMovimentacao =
  | "ADMISSAO" | "DESLIGAMENTO" | "TRANSFERENCIA_UNIDADE" | "TRANSFERENCIA_SETOR" | "PROMOCAO";
export const TIPO_MOVIMENTACAO_LABEL: Record<TipoMovimentacao, string> = {
  ADMISSAO: "Admissão",
  DESLIGAMENTO: "Desligamento",
  TRANSFERENCIA_UNIDADE: "Transferência de Unidade",
  TRANSFERENCIA_SETOR: "Transferência de Setor",
  PROMOCAO: "Promoção",
};

export type StatusMovimentacao = "PENDENTE" | "CONCLUIDA";
export const STATUS_MOVIMENTACAO_LABEL: Record<StatusMovimentacao, string> = { PENDENTE: "Pendente", CONCLUIDA: "Concluída" };
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
export const STATUS_MOVIMENTACAO_TONE: Record<StatusMovimentacao, "pos" | "neg" | "pend"> = { PENDENTE: "pend", CONCLUIDA: "pos" };

export type StatusImpacto = "NAO_SE_APLICA" | "PENDENTE_REVISAO" | "REVISADO";

// ---------------------------------------------------------------------------
// Domínio / listas mestras
// ---------------------------------------------------------------------------
export interface Unidade { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface Setor { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface Cargo { id: string; nome: string; setorId: string; setor?: Setor; }
export interface Empresa { id: string; razaoSocial: string; cnpj: string | null; }
export interface SistemaAcesso { id: string; nome: string; descricao: string | null; }
// Novas na Evolução Completa: dropdowns administráveis de Patrimônio,
// geridos pela página Configurações junto com as listas acima.
export interface CategoriaEquipamento { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface MarcaEquipamento { id: string; nome: string; status: "ATIVO" | "INATIVO"; }

// Catálogo de acessórios por categoria (17/07/2026) — ver aniversarios...
// não, ver comentário completo em schema.prisma/dominios.routes.ts do
// backend: `nome` só é único DENTRO da categoria, não globalmente (o mesmo
// "Carregador" existe como registro próprio em Notebook e em Celular).
export interface AcessorioEquipamento {
  id: string;
  nome: string;
  categoriaId: string;
  status: "ATIVO" | "INATIVO";
  categoria?: CategoriaEquipamento;
}
// Catálogo de Papelaria e Compras (09/07/2026) — mesmo racional de
// Categoria/Marca de Equipamento acima; categoriaId em ProdutoPapelaria é
// obrigatória (ON DELETE RESTRICT no backend), diferente da FK opcional das
// duas de cima.
export interface CategoriaProdutoPapelaria { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface ProdutoPapelaria {
  id: string;
  nome: string;
  categoriaId: string;
  categoria?: CategoriaProdutoPapelaria;
  unidadeMedidaPadrao: UnidadeMedidaProduto;
  status: "ATIVO" | "INATIVO";
  criadoEm: string;
  atualizadoEm: string;
}
// Catálogo de Solicitação de Equipamentos (09/07/2026, "Ajuste na Estrutura
// das Solicitações") — mesmo molde de CategoriaProdutoPapelaria/
// ProdutoPapelaria acima, só que sem unidade de medida (equipamento é
// sempre solicitado por unidade inteira). NÃO confundir com
// CategoriaEquipamento/MarcaEquipamento (linha 306 acima): aquelas são do
// registro de PATRIMÔNIO (equipamento físico já em posse da empresa); este
// catálogo é do PEDIDO (o que um colaborador pode solicitar comprar).
export interface CategoriaProdutoEquipamento { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface ProdutoEquipamento {
  id: string;
  nome: string;
  categoriaId: string;
  categoria?: CategoriaProdutoEquipamento;
  status: "ATIVO" | "INATIVO";
  criadoEm: string;
  atualizadoEm: string;
}

// Múltiplos telefones por colaborador (07/08/2026, pedido do Vini) — antes
// era um único campo de texto (`Colaborador.telefone`); virou uma lista de
// TelefoneColaborador (número + tipo + principal + observação opcional).
// Continua sendo telefone de CONTATO (pessoal/WhatsApp) — segue sem relação
// com `linhaCorporativa` (número corporativo, derivado de LinhaTelefonica).
export type TipoTelefoneColaborador = "CELULAR" | "RESIDENCIAL" | "COMERCIAL" | "WHATSAPP" | "OUTRO";

export const TIPO_TELEFONE_LABEL: Record<TipoTelefoneColaborador, string> = {
  CELULAR: "Celular",
  RESIDENCIAL: "Residencial",
  COMERCIAL: "Comercial",
  WHATSAPP: "WhatsApp",
  OUTRO: "Outro",
};

export interface TelefoneColaborador {
  id: string;
  colaboradorId: string;
  numero: string;
  tipo: TipoTelefoneColaborador;
  principal: boolean;
  observacao: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

// ---------------------------------------------------------------------------
// Entidades principais
// ---------------------------------------------------------------------------
export interface Colaborador {
  id: string;
  nomeCompleto: string;
  cpf: string | null; // mascarado pela API, salvo para quem tem permissão de ver completo; null em contas de função
  // Conta de função (ex: "Recepção Itaúna") em vez de pessoa física — cargo
  // roda entre pessoas diferentes, sem CPF fixo. O nome deve ser mantido
  // sempre atualizado com quem está no posto no momento.
  contaFuncao: boolean;
  email: string | null;
  // Telefone(s) de CONTATO (pessoal/WhatsApp) — desde a Etapa 1 (08/07/2026),
  // NÃO é tratado como número corporativo em nenhum lugar da UI. O número
  // corporativo de verdade é sempre `linhaCorporativa`, abaixo. Presente só
  // quando a API inclui a relação (list/get de Colaboradores).
  telefones?: TelefoneColaborador[];
  unidadeId: string | null;
  setorId: string | null;
  cargoId: string | null;
  status: StatusColaborador;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  // Mesma regra de visibilidade do CPF (07/07/2026) — só ADMINISTRADOR/
  // GESTOR_COORDENADOR recebe o valor de verdade; os demais recebem null.
  dataNascimento: string | null;
  observacoes: string | null;
  // Termo de responsabilidade de equipamento — anexo único (07/07/2026).
  // termoResponsabilidadeUrl também segue a mesma regra de visibilidade do
  // CPF/dataNascimento acima (null pra quem não pode ver).
  termoResponsabilidadeUrl: string | null;
  termoResponsabilidadeNomeOriginal: string | null;
  termoResponsabilidadeEnviadoEm: string | null;
  unidade?: Unidade | null;
  setor?: Setor | null;
  cargo?: Cargo | null;
  // Presente só quando a API inclui a relação (list/get de Colaboradores) —
  // usado pra decidir entre "Conceder acesso" e "Alterar papel do acesso".
  // `precisaTrocarSenha` (achado do Vini, 28/07/2026) — true = a conta ainda
  // está na senha temporária gerada na criação/reset, nunca trocada; false =
  // já completou o primeiro acesso e definiu a própria senha. Não existe
  // "senha universal" no sistema — cada conta recebe uma senha temporária
  // ALEATÓRIA (10 caracteres, ver gerarSenhaTemporaria no backend), mostrada
  // uma única vez pra quem criou/resetou o acesso.
  usuario?: { id: string; email: string; papel: Papel; ativo: boolean; precisaTrocarSenha: boolean } | null;
  // Etapa 1 (08/07/2026) — fonte única do número corporativo, derivada
  // sempre da LinhaTelefonica marcada como `principal` (nunca um campo de
  // texto solto). null quando o colaborador não tem nenhuma linha
  // corporativa vinculada.
  linhaCorporativa?: {
    id: string;
    numero: string;
    operadora: string | null;
    tipoPlano: TipoPlano;
    status: StatusLinha;
    situacaoConferencia: SituacaoConferenciaLinha;
  } | null;
}

export interface Equipamento {
  id: string;
  tipo: string;
  marca: string | null;
  modelo: string | null;
  numeroSerie: string | null;
  patrimonio: string | null;
  estadoConservacao: EstadoConservacao | null;
  status: StatusEquipamento;
  colaboradorId: string | null;
  observacoes: string | null;
  dataEntrega: string | null;
  dataDevolucao: string | null;
  // Campos novos da Evolução Completa — categoria/marca administráveis,
  // localização física e data de aquisição do bem.
  categoriaId: string | null;
  marcaId: string | null;
  localizacao: string | null;
  dataAquisicao: string | null;
  // CMDB completo (Onda 3.1 do redesenho, 21/07/2026 — item 11 da
  // auditoria, seção 1.5). `valorAtual`/`depreciacaoAcumulada` não são
  // colunas — são CALCULADOS pelo backend a cada leitura (ver
  // `comDepreciacao` em equipamentos.routes.ts) a partir de
  // valorAquisicao/dataAquisicao/vidaUtilMeses; vêm `null` quando falta
  // algum dos 3. QR Code também não é campo — é gerado no navegador a
  // partir de patrimonio/id (ver `QRCodeAtivo` em Equipamentos.tsx).
  garantiaAte: string | null;
  fornecedor: string | null;
  notaFiscal: string | null;
  valorAquisicao: number | string | null;
  vidaUtilMeses: number | null;
  valorAtual?: number | null;
  depreciacaoAcumulada?: number | null;
  colaborador?: { id: string; nomeCompleto: string } | null;
  // "De quem era" (17/07/2026, pedido do Vini) — dono anterior, preenchido
  // pelo backend quando o vínculo é desfeito/trocado; exibido só quando não
  // há dono atual (equipamento no estoque).
  ultimoColaborador?: { id: string; nomeCompleto: string } | null;
  categoria?: CategoriaEquipamento | null;
  marcaEquipamento?: MarcaEquipamento | null;
  // Acessórios inclusos e foto (17/07/2026, pedido do Vini: "se vem com
  // acessório ou não... permitir colocar foto do equipamento também, para
  // saber o estado em que se encontra"). `acessorios` vem da API já com o
  // `acessorio` aninhado (nome/categoria) — ver INCLUDE_EQUIPAMENTO no
  // backend — pra não exigir um 2º fetch só pra mostrar o nome na tela.
  acessorios?: { id: string; acessorioId: string; acessorio: AcessorioEquipamento }[];
  fotoUrl: string | null;
  fotoNomeOriginal: string | null;
  fotoEnviadaEm: string | null;
  // Lista de anexos (17/07/2026, pedido do Vini: "preciso que dê para
  // colocar várias fotos e anexos nos equipamentos") — substitui o slot
  // único de foto acima na tela; os 3 campos de cima continuam existindo só
  // por compatibilidade com dado antigo, sem UI nova escrevendo neles.
  anexos?: EquipamentoAnexo[];
}

// Rótulo legível e SEMPRE desambiguado de um equipamento — pra qualquer
// lista/seleção onde vários aparecem juntos (achado 22/07/2026, pedido do
// Vini ao revisar Chamados: o dropdown "Equipamento relacionado" mostrava
// "Notebook" repetido dezenas de vezes, sem nenhuma forma de saber qual é
// qual, porque o rótulo antigo só usava tipo + patrimônio — e a maioria dos
// equipamentos ainda não tem patrimônio cadastrado). Cadeia de fallback:
// categoria/tipo sempre primeiro, depois modelo (se tiver), depois
// patrimônio OU número de série (o que existir), e por ÚLTIMO um sufixo do
// próprio id — só entra em cena no caso raro de dois equipamentos idênticos
// em tudo (mesmo tipo, mesmo modelo, nenhum dos dois com patrimônio/série
// cadastrado), garantindo que duas opções NUNCA fiquem 100% iguais numa
// lista. Usar em todo Select/lista de equipamentos, no lugar de montar o
// texto na mão feito antes.
export function rotuloEquipamento(e: {
  id: string;
  tipo: string;
  modelo?: string | null;
  patrimonio?: string | null;
  numeroSerie?: string | null;
  categoria?: { nome: string } | null;
}): string {
  const partes = [e.categoria?.nome || e.tipo];
  if (e.modelo) partes.push(e.modelo);
  if (e.patrimonio) partes.push(`Patr. ${e.patrimonio}`);
  else if (e.numeroSerie) partes.push(`Série ${e.numeroSerie}`);
  else partes.push(`#${e.id.slice(-6)}`);
  return partes.join(" — ");
}

export interface EquipamentoAnexo {
  id: string;
  // Nome genérico gerado pelo servidor ("foto-equipamento.jpg") — o nome
  // original do upload não é guardado em lugar nenhum (pedido do Vini,
  // 17/07/2026). A tela nem exibe este campo; ele existe só como nome de
  // download.
  nomeOriginal: string;
  tipo: string;
  tamanhoBytes: number;
  // Posição na lista, controlada por arrastar-e-soltar (0-based).
  ordem: number;
  criadoEm: string;
}

export interface LinhaTelefonica {
  id: string;
  numero: string;
  operadora: string | null;
  plano: string | null;
  tipoPlano: TipoPlano;
  empresaId: string | null;
  colaboradorId: string | null;
  colaboradorInformado: string | null;
  // Etapa 1 (08/07/2026) — qual linha é a "principal" do colaborador
  // vinculado (fonte do número corporativo dele). Hoje ninguém tem mais de
  // uma linha, então isso normalmente é só `true` quando colaboradorId
  // existe.
  principal: boolean;
  situacaoConferencia: SituacaoConferenciaLinha;
  unidadeId: string | null;
  status: StatusLinha;
  observacoes: string | null;
  colaborador?: { id: string; nomeCompleto: string } | null;
  // "De quem era" (17/07/2026, pedido do Vini) — dono anterior da linha,
  // exibido quando ela está sem dono atual (ex: após desligamento).
  ultimoColaborador?: { id: string; nomeCompleto: string } | null;
  empresa?: Empresa | null;
  unidade?: Unidade | null;
  // Só presente em linhas pendentes (sem colaboradorId) quando o número
  // bate com o telefone de contato de algum colaborador já cadastrado —
  // sugestão de vínculo, nunca aplicada automaticamente.
  sugestaoColaborador?: { id: string; nomeCompleto: string } | null;
}

export interface AcessoSistema {
  id: string;
  colaboradorId: string;
  sistemaId: string;
  status: StatusAcesso;
  dataConcessao: string | null;
  dataRevogacao: string | null;
  observacoes: string | null;
  colaborador?: { id: string; nomeCompleto: string };
  sistema?: SistemaAcesso;
}

export interface LoteRateio {
  id: string;
  nome: string;
  descricao: string | null;
  dataInicio: string | null;
  dataFechamento: string | null;
  status: StatusLote;
  _count?: { solicitacoes: number };
}

export interface SolicitacaoEquipamento {
  id: string;
  // Número sequencial visível (achado de auditoria S12, 22/07/2026) — mesmo
  // padrão de Chamado/SolicitacaoPapelaria/SolicitacaoServico, que já tinham.
  numero: number;
  solicitanteId: string;
  // categoriaId/produtoId (09/07/2026) — opcionais: item "fora do catálogo"
  // continua existindo (produtoId ausente), `item` é sempre o texto exibido
  // (snapshot do nome do produto no momento da solicitação, quando veio do
  // catálogo — ver comentário no backend em solicitacoes.routes.ts).
  categoriaId: string | null;
  categoria?: CategoriaProdutoEquipamento | null;
  produtoId: string | null;
  produto?: ProdutoEquipamento | null;
  item: string;
  justificativa: string | null;
  prioridade: Prioridade;
  loteId: string | null;
  quantidade: number;
  valorUnitario: number;
  valorTotal?: number;
  // Fornecedor/loja da compra (17/07/2026, pedido do Vini) — texto livre,
  // definido/editado só por quem cuida da compra (Suporte TI/Financeiro/
  // Admin), nunca pelo colaborador solicitante.
  fornecedor: string | null;
  // Obrigatórios desde 07/07/2026 — local (unidade) e técnico responsável
  // escolhidos já na abertura da solicitação.
  unidadeId: string;
  tecnicoResponsavelId: string;
  status: StatusSolicitacao;
  dataSolicitacao: string;
  aprovadorId: string | null;
  // Achado de auditoria S2 (22/07/2026) — sem timeline própria (diferente de
  // Chamado/Papelaria/Serviço), o motivo de uma reprovação é gravado aqui
  // (ver comentário em solicitacoes.routes.ts, rota PATCH .../status).
  observacoes: string | null;
  solicitante?: { id: string; nomeCompleto: string };
  lote?: LoteRateio | null;
  unidade?: { id: string; nome: string };
  tecnicoResponsavel?: { id: string; email: string; nome: string };
}

// Item de uma remessa de Papelaria e Compras — snapshot resolvido pelo
// backend (nomeProduto/categoriaId sempre preenchidos, mesmo quando veio de
// um produtoId do catálogo) pra sobreviver a um produto renomeado/excluído
// depois (ver comentário em resolverItens() em
// solicitacoesPapelaria.routes.ts).
export interface ItemSolicitacaoPapelaria {
  id: string;
  solicitacaoId: string;
  produtoId: string | null;
  produto?: ProdutoPapelaria | null;
  nomeProduto: string;
  categoriaId: string;
  categoria?: CategoriaProdutoPapelaria;
  quantidade: number;
  unidadeMedida: UnidadeMedidaProduto;
  observacoes: string | null;
  criadoEm: string;
}

// Achado ao integrar com o backend (09/07/2026): diferente de
// responsavel/aprovador da SolicitacaoPapelaria abaixo (que o backend já
// resolve pra `{id,email,nome}` via nomeExibicaoUsuario, ver comNomes() em
// solicitacoesPapelaria.routes.ts), o autor de um EventoSolicitacaoPapelaria
// vem cru, com `colaborador` aninhado em vez de um campo `nome` plano — a
// rota de eventos não passa pelo mesmo helper. Mostrar `colaborador
// ?.nomeCompleto` com fallback pro e-mail (mesma regra do
// nomeExibicaoUsuario) resolve isso na tela sem exigir mudança no backend.
export interface EventoSolicitacaoPapelaria {
  id: string;
  solicitacaoId: string;
  tipo: TipoEventoSolicitacaoPapelaria;
  autorId: string | null;
  mensagem: string | null;
  detalhe: Record<string, unknown> | null;
  criadoEm: string;
  autor?: { id: string; email: string; papel: Papel; colaborador?: { nomeCompleto: string } | null } | null;
}

export interface SolicitacaoPapelaria {
  id: string;
  numero: number;
  tipo: TipoSolicitacaoPapelaria;
  unidadeId: string;
  unidade?: { id: string; nome: string };
  responsavelId: string;
  responsavel?: { id: string; email: string; nome: string };
  // Achado de investigação (22/07/2026, pedido do Vini) — "quem de fato
  // enviou o pedido", sempre o usuário logado no momento da criação, nunca
  // reatribuído. Distinto de responsavel quando a solicitação foi aberta
  // "em nome de" outra pessoa (ADMINISTRADOR/GESTOR_COORDENADOR delegando a
  // quem vai cuidar da compra) — nesse caso responsavel deixa de ser quem
  // pediu. Ver comentário completo em schema.prisma.
  criadoPorId: string;
  criadoPor?: { id: string; email: string; nome: string };
  aprovadorId: string | null;
  aprovador?: { id: string; email: string; nome: string } | null;
  status: StatusSolicitacaoPapelaria;
  prioridade: Prioridade;
  justificativa: string | null;
  observacoes: string | null;
  dataSolicitacao: string;
  dataConclusao: string | null;
  criadoEm: string;
  atualizadoEm: string;
  // Calculado pelo backend só quando dataConclusao existe (mesmo racional de
  // ChamadoManutencao.tempoAtendimentoMs abaixo).
  tempoAtendimentoMs: number | null;
  // Presentes só no GET de detalhe (/:id) — a listagem paginada devolve só
  // `_count.itens`, sem os arrays completos (ver INCLUDE_LISTA no backend).
  itens?: ItemSolicitacaoPapelaria[];
  eventos?: EventoSolicitacaoPapelaria[];
  _count?: { itens: number };
}

export interface ChamadoEvento {
  id: string;
  chamadoId: string;
  tipo: TipoEventoChamado;
  autorId: string | null;
  mensagem: string | null;
  detalhe: Record<string, unknown> | null;
  anexoUrl: string | null;
  criadoEm: string;
  // `nome` (achado do Vini, 28/07/2026) — resolvido no backend a partir do
  // colaborador vinculado (ver comNomeAutorEvento em chamados.routes.ts),
  // mesmo padrão já usado em `responsavel.nome` logo abaixo. Antes disso o
  // "Histórico e Conversa" mostrava o e-mail cru de quem escreveu — ninguém
  // reconhece um colega pelo e-mail de cabeça.
  autor?: { id: string; email: string; papel: Papel; nome: string } | null;
}

export interface ChamadoManutencao {
  id: string;
  numero: number;
  solicitanteId: string;
  categoria: CategoriaChamado;
  // Imoview CRM (09/07/2026) — sempre null pra qualquer outra categoria.
  tipoSolicitacaoImoview: TipoSolicitacaoImoview | null;
  codigoImovel: string | null;
  equipamentoId: string | null;
  descricao: string;
  // Obrigatório desde 07/07/2026 — unidade escolhida já na abertura do
  // chamado. `local` abaixo continua opcional, é só detalhe extra (ex: "Sala
  // TI") dentro da unidade.
  unidadeId: string;
  local: string | null;
  prioridade: Prioridade;
  fornecedorExterno: string | null;
  // Obrigatório desde 07/07/2026 — técnico responsável escolhido já na
  // abertura do chamado (antes só era preenchido ao mexer no status).
  responsavelId: string;
  valorPrevisto: number | null;
  valorFinal: number | null;
  status: StatusChamado;
  dataAbertura: string;
  dataConclusao: string | null;
  observacoes: string | null;
  // Ausente na resposta da API pra quem é COLABORADOR — nunca depender deste
  // campo pra decidir o que mostrar, o backend já filtra por papel.
  observacoesInternas?: string | null;
  solucaoAplicada: string | null;
  tempoAtendimentoMs: number | null;
  // Fase 2 — Melhorias Estruturais (09/07/2026). `slaPrazo` é calculado
  // automaticamente na abertura (ver calcularSlaPrazo no backend) — "no
  // prazo" ou "atrasado" é derivado comparando com a hora atual, não um
  // campo próprio. `reaberturas` conta quantas vezes voltou de
  // RESOLVIDO/ENCERRADO pra ABERTO. Avaliação é sempre a mais recente
  // (sobrescrita a cada nova avaliação) — o histórico de cada uma já fica
  // preservado na linha do tempo (`eventos`, tipo AVALIACAO).
  slaPrazo: string | null;
  reaberturas: number;
  avaliacaoNota: number | null;
  avaliacaoComentario: string | null;
  avaliadoEm: string | null;
  solicitante?: { id: string; nomeCompleto: string };
  equipamento?: Equipamento | null;
  responsavel?: { id: string; email: string; nome: string } | null;
  unidade?: { id: string; nome: string };
  eventos?: ChamadoEvento[];
}

// Dashboard de indicadores de suporte (Fase 2, 09/07/2026) — resposta de
// GET /chamados-manutencao/stats, ver cálculo completo em
// chamados.routes.ts no backend (feito em JS sobre os chamados do período,
// não groupBy — mais simples de entender/depurar e o volume atual da
// empresa não pesa nisso).
export interface ChamadoStatsPorUnidade { unidadeId: string; nome: string; total: number }
export interface ChamadoStatsPorTecnico { responsavelId: string; nome: string; total: number; tempoMedioResolucaoMs: number | null }
export interface ChamadoStats {
  periodo: { dias: number | null; desde: string | null };
  totalChamados: number;
  porStatus: Partial<Record<StatusChamado, number>>;
  porCategoria: Partial<Record<CategoriaChamado, number>>;
  porUnidade: ChamadoStatsPorUnidade[];
  porTecnico: ChamadoStatsPorTecnico[];
  tempoMedioResolucaoMs: number | null;
  chamadosAtrasados: number;
  taxaReaberturaPct: number;
  avaliacao: {
    media: number | null;
    totalAvaliados: number;
    distribuicao: Record<"1" | "2" | "3" | "4" | "5", number>;
  };
}

export interface MovimentacaoColaborador {
  id: string;
  colaboradorId: string;
  tipo: TipoMovimentacao;
  unidadeAnteriorId: string | null;
  setorAnteriorId: string | null;
  novaUnidadeId: string | null;
  novoSetorId: string | null;
  responsavelId: string;
  status: StatusMovimentacao;
  impactoAcessos: StatusImpacto;
  impactoLinhas: StatusImpacto;
  impactoEquipamentos: StatusImpacto;
  observacoes: string | null;
  data: string;
  colaborador?: {
    id: string;
    nomeCompleto: string;
    // Etapa 3 (auditoria de backend, 08/07/2026): backend passou a mandar
    // contagem agregada (_count) em vez do array completo de ids — mesma
    // informação (quantidade), sem carregar/transferir os ids em si.
    _count: { equipamentos: number; linhas: number; acessos: number };
  };
}

export interface HistoricoTroca {
  id: string;
  equipamentoId: string;
  tipoEvento: "ENTREGA" | "TROCA" | "DEVOLUCAO" | "MANUTENCAO" | "BAIXA";
  colaboradorOrigemId: string | null;
  colaboradorDestinoId: string | null;
  responsavelRegistroId: string;
  status: "CONCLUIDO" | "PENDENTE";
  observacoes: string | null;
  data: string;
  equipamento?: { id: string; tipo: string; modelo: string | null };
  colaboradorOrigem?: { id: string; nomeCompleto: string } | null;
  colaboradorDestino?: { id: string; nomeCompleto: string } | null;
}

export interface Usuario {
  id: string;
  email: string;
  papel: Papel;
  colaboradorId: string | null;
  ativo?: boolean;
  precisaTrocarSenha?: boolean;
}

// RH — Documentos de colaborador (11/08/2026). Ver backend/prisma/schema.prisma
// (models TipoDocumento/DocumentoColaborador/DocumentoColaboradorEvento) e
// src/routes/documentos.routes.ts para o contrato completo.
export type StatusDocumentoColaborador =
  | "SOLICITADO" | "ENVIADO" | "EM_ANALISE" | "APROVADO" | "REJEITADO" | "EXPIRADO" | "CANCELADO";

export const STATUS_DOCUMENTO_LABEL: Record<StatusDocumentoColaborador, string> = {
  SOLICITADO: "Aguardando envio",
  ENVIADO: "Enviado — em análise",
  EM_ANALISE: "Em análise",
  APROVADO: "Aprovado",
  REJEITADO: "Rejeitado",
  EXPIRADO: "Vencido",
  CANCELADO: "Cancelado",
};

export type TipoEventoDocumentoColaborador =
  | "SOLICITACAO" | "ENVIO" | "REENVIO_SOLICITADO" | "ANALISE_APROVADA"
  | "ANALISE_REJEITADA" | "COMENTARIO" | "ALERTA_VENCIMENTO" | "EXPIRADO" | "CANCELADO";

export interface TipoDocumento {
  id: string;
  nome: string;
  descricao: string | null;
  exigeValidade: boolean;
  diasAntecedenciaAlerta: number[];
  status: "ATIVO" | "INATIVO";
  criadoEm: string;
  atualizadoEm: string;
}

export interface DocumentoColaboradorEvento {
  id: string;
  documentoId: string;
  tipo: TipoEventoDocumentoColaborador;
  autorId: string | null;
  autor?: { id: string; email: string } | null;
  mensagem: string | null;
  detalhe: Record<string, unknown> | null;
  criadoEm: string;
}

export interface DocumentoColaborador {
  id: string;
  colaboradorId: string;
  colaborador?: { id: string; nomeCompleto: string };
  tipoDocumentoId: string;
  tipoDocumento: { id: string; nome: string; descricao?: string | null; exigeValidade: boolean };
  status: StatusDocumentoColaborador;
  solicitadoPorId: string | null;
  solicitadoEm: string;
  observacaoSolicitacao: string | null;
  arquivoUrl: string | null;
  arquivoNomeOriginal: string | null;
  arquivoTipo: string | null;
  arquivoTamanhoBytes: number | null;
  enviadoEm: string | null;
  dataValidade: string | null;
  analisadoPorId: string | null;
  analisadoEm: string | null;
  motivoRejeicao: string | null;
  alertasVencimentoEnviados: number[];
  criadoEm: string;
  atualizadoEm: string;
  eventos?: DocumentoColaboradorEvento[];
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// Marketing Imobiliário (13/08/2026) — Banco de Imóveis + integração
// Imoview (Fases 1+2+8). Ver src/pages/Marketing.tsx e src/api/marketing.ts.
// ---------------------------------------------------------------------------

export type StatusImovel = "DISPONIVEL" | "RESERVADO" | "VENDIDO" | "INATIVO";
export const STATUS_IMOVEL_LABEL: Record<StatusImovel, string> = {
  DISPONIVEL: "Disponível",
  RESERVADO: "Reservado",
  VENDIDO: "Vendido",
  INATIVO: "Inativo",
};
export const STATUS_IMOVEL_TONE: Record<StatusImovel, "pos" | "neg" | "pend"> = {
  DISPONIVEL: "pos",
  RESERVADO: "pend",
  VENDIDO: "pos",
  INATIVO: "neg",
};

export type PrioridadeImovel = "A_COMERCIAL" | "B_PORTFOLIO" | "C_ESTOQUE";
export const PRIORIDADE_IMOVEL_LABEL: Record<PrioridadeImovel, string> = {
  A_COMERCIAL: "A — Comercial",
  B_PORTFOLIO: "B — Portfólio",
  C_ESTOQUE: "C — Estoque",
};

export type TipoImovel = "CASA" | "APARTAMENTO" | "LOTE" | "CHACARA" | "OUTRO";
export const TIPO_IMOVEL_LABEL: Record<TipoImovel, string> = {
  CASA: "Casa",
  APARTAMENTO: "Apartamento",
  LOTE: "Lote",
  CHACARA: "Chácara",
  OUTRO: "Outro",
};

export interface ImovelMarketing {
  id: string;
  codigo: string;
  unidadeId: string;
  unidade?: Unidade;
  tipo: TipoImovel;
  bairroRegiao: string | null;
  descricaoCurta: string | null;
  valor: number | string | null;
  corretorId: string | null;
  corretor?: { id: string; nomeCompleto: string } | null;
  corretorNome: string | null;
  temFotos: boolean;
  temVideo: boolean;
  linkPasta: string | null;
  prioridade: PrioridadeImovel;
  status: StatusImovel;
  observacoes: string | null;
  // Campos da Fase 8 (Integração Imoview) — sempre presentes na resposta,
  // mas só relevantes/preenchidos quando origemImoview é true. Somente
  // leitura no formulário quando o imóvel veio da sincronização (ver
  // Marketing.tsx).
  origemImoview: boolean;
  codigoImoview: number | null;
  fotoPrincipalUrl: string | null;
  fotosUrls: string[];
  videoUrl: string | null;
  tituloSugerido: string | null;
  descricaoSugerida: string | null;
  ultimaSincronizacaoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

// 4 domínios extensíveis do módulo (mesmo formato simples de
// CategoriaProdutoPapelaria acima) — Marketing/Administrador cadastram sem
// depender de deploy.
export interface CanalMarketing { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface ObjetivoMarketing { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface OrigemLeadMarketing { id: string; nome: string; status: "ATIVO" | "INATIVO"; }
export interface TipoCriativoMarketing { id: string; nome: string; status: "ATIVO" | "INATIVO"; }

export interface SincronizacaoImoviewLog {
  id: string;
  executadoEm: string;
  sucesso: boolean;
  quantidade: number;
  erro: string | null;
}

export interface StatusSincronizacaoImoview {
  ativa: boolean;
  registros: SincronizacaoImoviewLog[];
}

// Tons visuais dos "Stamps" (badges de status) — igual ao protótipo original.
const POSITIVOS = new Set([
  "Ativo", "Ativa", "Concluído", "Concluída", "Aprovado", "Aprovada", "Entregue", "Comprado",
  "Revisado", "Em uso", "Fechado", "Disponível", "Bom", "Novo", "Resolvido",
]);
const NEGATIVOS = new Set([
  "Inativo", "Cancelado", "Cancelada", "Reprovado", "Reprovada", "Bloqueado", "Revogado",
  "Baixado", "Sem solução", "Danificado", "Perdido", "Descartado",
]);
export function tone(status: string | null | undefined): "pos" | "neg" | "pend" {
  if (!status) return "pend";
  if (POSITIVOS.has(status)) return "pos";
  if (NEGATIVOS.has(status)) return "neg";
  return "pend";
}

// ---------------------------------------------------------------------------
// Pagamentos de Colaboradores — CNAB 240 Sicoob (20/07/2026, pedido do Vini)
// ---------------------------------------------------------------------------

export interface DadosBancariosColaborador {
  id: string;
  colaboradorId: string;
  bancoCodigo: string;
  bancoNome: string;
  agencia: string;
  agenciaDv: string | null;
  conta: string;
  contaDv: string | null;
  tipoConta: string;
  favorecidoNome: string | null;
  favorecidoCpf: string | null;
  endereco: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  cep: string;
  uf: string;
  // Dados financeiros padrão (21/07/2026, pedido do Vini) — só sugestão pro
  // lançamento em lote, nunca obrigatório nem trava a edição manual.
  salarioPadrao: string | number | null;
  valorAdiantamentoPadrao: string | number | null;
}

export type TipoPagamentoColaborador =
  | "SALARIO" | "ADIANTAMENTO" | "FERIAS" | "RESCISAO" | "COMISSAO" | "BONIFICACAO" | "OUTROS";
// ESTORNADO (22/07/2026, pedido do Vini: "muitas vezes o pagamento via Pix,
// TED, etc é estornado e dias depois o financeiro descobre") — só alcançável
// a partir de PAGO; diferente de REJEITADO (banco recusa a remessa ANTES de
// pagar) e de CANCELADO (decisão interna de não pagar).
export type StatusPagamentoColaborador = "PENDENTE" | "EM_REMESSA" | "PAGO" | "REJEITADO" | "CANCELADO" | "ESTORNADO";
export type StatusRemessaCnab = "GERADA" | "ENVIADA" | "PROCESSADA" | "REJEITADA" | "CANCELADA";
// Forma de pagamento (22/07/2026, pedido do Vini: "coloca uma opção de
// formas de pagamentos no pagamento avulso") — opcional em qualquer
// PagamentoColaborador, mais relevante em avulso (pagamento de folha sempre
// sai via CNAB/TED, então já é implícito).
export type FormaPagamento = "PIX" | "TED" | "DOC" | "DINHEIRO" | "CHEQUE" | "OUTRO";

export const TIPO_PAGAMENTO_LABEL: Record<TipoPagamentoColaborador, string> = {
  SALARIO: "Salário", ADIANTAMENTO: "Adiantamento", FERIAS: "Férias", RESCISAO: "Rescisão",
  COMISSAO: "Comissão", BONIFICACAO: "Bonificação", OUTROS: "Outros",
};
export const FORMA_PAGAMENTO_LABEL: Record<FormaPagamento, string> = {
  PIX: "Pix", TED: "TED", DOC: "DOC", DINHEIRO: "Dinheiro", CHEQUE: "Cheque", OUTRO: "Outro",
};
export const STATUS_PAGAMENTO_LABEL: Record<StatusPagamentoColaborador, string> = {
  PENDENTE: "Pendente", EM_REMESSA: "Em remessa", PAGO: "Pago", REJEITADO: "Rejeitado", CANCELADO: "Cancelado",
  ESTORNADO: "Estornado",
};
export const STATUS_REMESSA_LABEL: Record<StatusRemessaCnab, string> = {
  GERADA: "Gerada", ENVIADA: "Enviada", PROCESSADA: "Processada", REJEITADA: "Rejeitada", CANCELADA: "Cancelada",
};

// Cores explícitas de status (22/07/2026, pedido do Vini: "aquele pagamento
// que estiver pendente ou aberto for em amarelo e aquele que estiver pago
// ou fechado em verde") — passadas como prop `tone` pro <Stamp>, ver
// comentário completo em ui.tsx sobre por que a auto-detecção genérica não
// servia pra estes rótulos.
export const STATUS_PAGAMENTO_TONE: Record<StatusPagamentoColaborador, "pos" | "neg" | "pend"> = {
  PENDENTE: "pend",
  EM_REMESSA: "pend",
  PAGO: "pos",
  REJEITADO: "neg",
  CANCELADO: "neg",
  ESTORNADO: "neg",
};
export const STATUS_FOLHA_TONE: Record<"ABERTA" | "FECHADA", "pos" | "neg" | "pend"> = {
  ABERTA: "pend",
  FECHADA: "pos",
};
export const STATUS_REMESSA_TONE: Record<StatusRemessaCnab, "pos" | "neg" | "pend"> = {
  GERADA: "pend",
  ENVIADA: "pend",
  PROCESSADA: "pos",
  REJEITADA: "neg",
  CANCELADA: "neg",
};

export interface PagamentoColaborador {
  id: string;
  numero: number;
  // Nullable desde 22/07/2026 (pedido do Vini: pagamentos avulsos, "apenas
  // para ter registro, sem precisar de arquivo de remessa nem nada") — um
  // pagamento sem folha é um avulso, ver comentário completo no schema.prisma
  // do backend.
  folhaId: string | null;
  colaboradorId: string;
  colaborador?: { id: string; nomeCompleto: string; cpf: string | null };
  tipo: TipoPagamentoColaborador;
  valor: string | number;
  dataPrevista: string | null;
  formaPagamento: FormaPagamento | null;
  observacoes: string | null;
  status: StatusPagamentoColaborador;
  remessaId: string | null;
  remessa?: { id: string; numero: number; status: StatusRemessaCnab; dataGeracao: string } | null;
  ocorrencias: string | null;
  dataConfirmacao: string | null;
  // Recibo individual (21/07/2026, pedido do Vini) — vem do split automático
  // do PDF bruto da folha ou de anexo manual avulso. Nem todo pagamento tem
  // um (documento de apoio, nunca referência obrigatória pro valor pago).
  reciboUrl: string | null;
  reciboNomeOriginal: string | null;
  reciboTipo: string | null;
  reciboEnviadoEm: string | null;
  // Estorno (22/07/2026) — só preenchido quando status vira ESTORNADO.
  // `dataEstorno` é quando o banco de fato reverteu (pode ser dias antes de
  // `estornadoEm`, que é só quando ficou registrado no sistema).
  dataEstorno: string | null;
  motivoEstorno: string | null;
  estornadoEm: string | null;
  estornadoPorId: string | null;
  criadoEm: string;
}

export interface FolhaPagamento {
  id: string;
  numero: number;
  competencia: string;
  descricao: string | null;
  // Tipo da folha inteira (21/07/2026) — todo pagamento lançado nela herda
  // este tipo por padrão.
  tipo: TipoPagamentoColaborador;
  // Data única de pagamento (21/07/2026) — o CNAB só comporta uma data por
  // remessa; decidida no nível da folha, ajustável até a geração da remessa.
  dataPagamento: string | null;
  status: "ABERTA" | "FECHADA";
  pagamentos: PagamentoColaborador[];
  remessas: { id: string; numero: number; status: StatusRemessaCnab; dataGeracao: string; valorTotal: string; quantidadePagamentos: number }[];
  valorTotal: string | number;
  criadoEm: string;
}

export interface RemessaCnab {
  id: string;
  numero: number;
  folha?: { numero: number; competencia: string } | null;
  dataGeracao: string;
  dataPagamento: string;
  geradoPor?: { email: string; colaborador?: { nomeCompleto: string } | null } | null;
  quantidadePagamentos: number;
  valorTotal: string | number;
  status: StatusRemessaCnab;
  arquivoNome: string;
  retornoImportadoEm: string | null;
  pagamentos: PagamentoColaborador[];
}

export interface ConfiguracaoPagamento {
  bancoCodigo: string; bancoNome: string; razaoSocial: string; cnpj: string; convenio: string;
  agencia: string; agenciaDv: string; conta: string; contaDv: string;
  endereco: string; numero: string; complemento: string; cidade: string; cep: string; uf: string;
  proximoSequencialRemessa: number;
}

// ---------------------------------------------------------------------------
// Solicitações de Serviço (20/07/2026, pedido do Vini)
// ---------------------------------------------------------------------------

export type StatusSolicitacaoServico = "ABERTA" | "EM_ATENDIMENTO" | "AGUARDANDO_CONTRATACAO" | "CONCLUIDA" | "RECUSADA";
export const STATUS_SERVICO_LABEL: Record<StatusSolicitacaoServico, string> = {
  ABERTA: "Aberta",
  EM_ATENDIMENTO: "Em atendimento (TI)",
  AGUARDANDO_CONTRATACAO: "Aguardando contratação (Financeiro)",
  CONCLUIDA: "Concluída",
  RECUSADA: "Recusada",
};
// Tom explícito (28/07/2026) — ver comentário completo em STATUS_COLABORADOR_TONE.
export const STATUS_SERVICO_TONE: Record<StatusSolicitacaoServico, "pos" | "neg" | "pend"> = {
  ABERTA: "pend",
  EM_ATENDIMENTO: "pend",
  AGUARDANDO_CONTRATACAO: "pend",
  CONCLUIDA: "pos",
  RECUSADA: "neg",
};

export interface SolicitacaoServico {
  id: string;
  numero: number;
  solicitanteId: string;
  solicitante?: { id: string; nomeCompleto: string };
  servico: string;
  descricao: string | null;
  unidadeId: string | null;
  unidade?: { id: string; nome: string } | null;
  status: StatusSolicitacaoServico;
  precisaContratacao: boolean;
  fornecedor: string | null;
  valorEstimado: string | number | null;
  criadoEm: string;
  eventos: {
    id: string;
    mensagem: string;
    criadoEm: string;
    autor?: { email: string; colaborador?: { nomeCompleto: string } | null } | null;
  }[];
}

// Busca Global (Onda 2.1 do redesign, 21/07/2026) — resposta de GET /busca,
// ver o mesmo shape em busca.routes.ts no backend. `moduloKey`/`payload`
// seguem exatamente a convenção de `navegarPara(moduloKey, payload)` em
// App.tsx (mesma usada por notificações e outros deep-links do sistema) —
// o resultado de busca não inventa navegação própria, só entrega os
// parâmetros prontos pro mecanismo que já existe.
export type TipoResultadoBusca =
  | "colaborador" | "equipamento" | "chamado" | "sol_equipamento" | "sol_papelaria" | "sol_servico" | "sistema_acesso";

export interface ResultadoBusca {
  tipo: TipoResultadoBusca;
  id: string;
  titulo: string;
  subtitulo: string | null;
  moduloKey: string;
  payload: Record<string, unknown>;
}
