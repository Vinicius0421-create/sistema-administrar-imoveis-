import { FastifyInstance } from "fastify";
import { z } from "zod";
import { StatusAtivoInativo, UnidadeMedidaProduto } from "@prisma/client";
import { registrarAuditoria } from "../utils/audit";
import { somenteDigitos, isValidCnpj } from "../utils/validacao";
import { avisarMudanca } from "../utils/realtime";

// Padronização Global (Fase 3, 09/07/2026) — mesma convenção de CPF/telefone
// (ver comentário em utils/validacao.ts): CNPJ armazenado como dígitos
// puros, validado por dígito verificador antes de salvar. A máscara
// (99.999.999/9999-99) é só de apresentação, aplicada no frontend.
function validarCnpjOpcional(data: { cnpj?: string | null }, ctx: z.RefinementCtx) {
  if (data.cnpj && !isValidCnpj(data.cnpj)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cnpj"], message: "CNPJ inválido." });
  }
}

const empresaCreateSchema = z
  .object({
    razaoSocial: z.string().min(2),
    cnpj: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? somenteDigitos(v) : v)),
  })
  .superRefine(validarCnpjOpcional);

const empresaUpdateSchema = z
  .object({
    razaoSocial: z.string().min(2).optional(),
    cnpj: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? somenteDigitos(v) : v)),
  })
  .superRefine(validarCnpjOpcional);

// Tabelas de domínio/lookup (Unidade, Setor, Cargo, Empresa, SistemaAcesso,
// CategoriaEquipamento, MarcaEquipamento).
//
// Até a Evolução Completa (07/2026) essas listas eram só-leitura por design:
// cadastradas via seed/migração, sem UI. Isso NUNCA bateu com a especificação
// original do sistema (09_Pagina_Configuracoes.md, era Airtable), que sempre
// previu uma página "⚙️ Configurações" com "+ Nova Unidade" / "+ Novo Setor"
// etc. — e o pedido do usuário reforçou isso explicitamente ("Categoria/
// Marca/Situação devem ser dropdowns administráveis"). Esta rota vira CRUD
// (create + editar nome + ativar/inativar) para as 7 listas mestras.
// Restrito a ADMINISTRADOR: são ajustes de estrutura organizacional, de uso
// raro, com efeito em todo o sistema — o próprio doc original já dizia
// "não é necessário entrar aqui no dia a dia normal".
//
// Etapa 9 (Refatoração Inteligente, 08/07/2026): os 7 domínios sempre foram
// GET/POST/PATCH/DELETE quase byte-a-byte idênticos entre si — só mudava o
// model do Prisma, o rótulo nas mensagens de erro, e alguns detalhes
// pontuais (campo `status` existe ou não, `.min()` do nome — MarcaEquipamento
// sempre usou `.min(1)`, os outros `.min(2)`, sem explicação documentada;
// checagem de "está em uso" antes de excluir). 5 dos 7 (Unidade, Setor,
// SistemaAcesso, CategoriaEquipamento, MarcaEquipamento) foram extraídos
// para `registrarDominioSimples`, parametrizado por essas diferenças.
//
// Cargo e Empresa ficaram de fora do molde genérico de propósito, não por
// esquecimento: Cargo tem chave de unicidade composta (`@@unique([nome,
// setorId])`, não `nome` sozinho) e precisa validar que o `setorId` enviado
// existe antes de criar/mover um cargo pra ele; Empresa usa `razaoSocial`
// em vez de `nome` (inclusive pra ordenação) e tem 2 checagens de
// duplicidade independentes (razão social E CNPJ, cada uma opcionalmente
// excluindo o próprio registro no PATCH). Forçar os dois no mesmo molde do
// genérico exigiria tantos parâmetros/exceções especiais que o resultado
// ficaria mais difícil de entender do que 2 blocos explícitos — mantidos
// como estavam, só reposicionados.
interface DominioSimplesConfig {
  path: string; // ex: "unidades" → GET/POST /unidades, PATCH/DELETE /unidades/:id
  model:
    | "unidade"
    | "setor"
    | "sistemaAcesso"
    | "categoriaEquipamento"
    | "marcaEquipamento"
    | "categoriaProdutoPapelaria"
    | "categoriaProdutoEquipamento";
  entidade: string; // nome gravado no log de auditoria, ex: "Unidade"
  artigo: string; // usado nas mensagens de duplicidade, ex: "uma unidade" / "um setor"
  naoEncontrada: string; // ex: "Unidade não encontrada." (concordância de gênero varia por domínio)
  minNome: number;
  temStatus: boolean;
  temDescricao?: boolean; // só SistemaAcesso tem esse campo extra opcional
  // Checagem de "está em uso" antes de excluir — só Setor (cargos) e
  // SistemaAcesso (acessos concedidos) têm isso, porque são os únicos 2 dos
  // 5 domínios deste grupo com uma FK obrigatória (ON DELETE RESTRICT)
  // apontando pra eles. Retorna a mensagem de bloqueio, ou `null` se pode
  // excluir. Roda como uma consulta separada da que busca o registro pro
  // 404 — no volume de uso deste CRUD (admin, raríssimo, nunca em lote) o
  // custo de uma query extra é irrelevante frente ao ganho de não duplicar
  // os 7 blocos de código.
  verificarUso?: (app: FastifyInstance, id: string) => Promise<string | null>;
}

function registrarDominioSimples(app: FastifyInstance, config: DominioSimplesConfig) {
  // A tipagem do client do Prisma não indexa bem por união de nomes de
  // model dinamicamente — resolvido em runtime (os 5 nomes em `model` são
  // todos delegates válidos de app.prisma), então este único ponto usa
  // `as any` em vez de espalhar o mesmo cast pelas 4 rotas.
  const prismaModel = (app.prisma as any)[config.model];

  app.get(`/${config.path}`, { preHandler: [app.authenticate] }, async (_request, reply) => {
    const itens = await prismaModel.findMany({ orderBy: { nome: "asc" } });
    return reply.send(itens);
  });

  app.post(
    `/${config.path}`,
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const shape: z.ZodRawShape = { nome: z.string().min(config.minNome) };
      if (config.temDescricao) shape.descricao = z.string().optional().nullable();
      const parsed = z.object(shape).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      // Achado de auditoria (06/07/2026): nenhuma das 7 listas de domínio
      // pré-checava duplicidade de nome antes do create — um cadastro
      // repetido (typo, duplo clique) virava violação de unique constraint
      // do Postgres → 500 genérico, em vez do 409 com mensagem clara que o
      // resto do sistema já usa (ver checagem de CPF em colaboradores.routes.ts).
      const jaExiste = await prismaModel.findUnique({ where: { nome: (parsed.data as { nome: string }).nome } });
      if (jaExiste) return reply.code(409).send({ error: `Já existe ${config.artigo} com este nome.` });
      const item = await prismaModel.create({ data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: config.entidade, entidadeId: item.id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(201).send(item);
    }
  );

  app.patch(
    `/${config.path}/:id`,
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const shape: z.ZodRawShape = { nome: z.string().min(config.minNome).optional() };
      if (config.temDescricao) shape.descricao = z.string().optional().nullable();
      if (config.temStatus) shape.status = z.nativeEnum(StatusAtivoInativo).optional();
      const parsed = z.object(shape).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const nome = (parsed.data as { nome?: string }).nome;
      if (nome) {
        const jaExiste = await prismaModel.findUnique({ where: { nome } });
        if (jaExiste && jaExiste.id !== id) return reply.code(409).send({ error: `Já existe ${config.artigo} com este nome.` });
      }
      const item = await prismaModel.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: config.entidade, entidadeId: id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.send(item);
    }
  );

  app.delete(
    `/${config.path}/:id`,
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const item = await prismaModel.findUnique({ where: { id } });
      if (!item) return reply.code(404).send({ error: config.naoEncontrada });
      if (config.verificarUso) {
        const bloqueio = await config.verificarUso(app, id);
        if (bloqueio) return reply.code(409).send({ error: bloqueio });
      }
      await prismaModel.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: config.entidade, entidadeId: id, detalhe: { nome: item.nome }, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(204).send();
    }
  );
}

export default async function dominiosRoutes(app: FastifyInstance) {
  // Diferente de Cargo/SistemaAcesso: até esta etapa, excluir uma Unidade
  // não checava se havia ChamadoManutencao ou SolicitacaoEquipamento
  // vinculados — ambos têm `unidadeId` OBRIGATÓRIO (ON DELETE RESTRICT), a
  // mesma situação que já rendeu checagem de uso em Setor (cargos) e
  // SistemaAcesso (acessos). Sem a checagem, excluir uma unidade "em uso"
  // por chamados/solicitações não quebrava nada (o Postgres rejeita a FK),
  // mas caía no handler de erro genérico (P2003 → 400 "Referência
  // inválida...") em vez da mensagem específica com contagem que o padrão
  // dos outros 2 domínios já usa. Corrigido como parte da extração genérica.
  registrarDominioSimples(app, {
    path: "unidades",
    model: "unidade",
    entidade: "Unidade",
    artigo: "uma unidade",
    naoEncontrada: "Unidade não encontrada.",
    minNome: 2,
    temStatus: true,
    verificarUso: async (app, id) => {
      const unidade = await app.prisma.unidade.findUnique({
        where: { id },
        // Achado de auditoria (10/07/2026, Ciclo de Evolução Contínua):
        // solicitacoesPapelaria.unidadeId também é FK obrigatória com
        // ON DELETE RESTRICT (ver migração do módulo Papelaria e Compras,
        // 09/07/2026) — o banco já impedia o registro órfão, mas essa
        // contagem não incluía papelaria (escrita antes desse módulo
        // existir), então excluir uma unidade só referenciada por
        // solicitações de papelaria caía no erro genérico de violação de
        // FK do Postgres em vez desta mensagem amigável.
        //
        // Achado de auditoria (Ciclo de Evolução Contínua Nº 3, 10/07/2026):
        // Colaborador.unidadeId e LinhaTelefonica.unidadeId são FK
        // OPCIONAIS (ON DELETE SET NULL) — diferente das obrigatórias
        // acima, o Postgres não bloqueia a exclusão nesse caso, então uma
        // unidade com colaboradores/linhas vinculados podia ser excluída
        // silenciosamente, e todo `colaborador.unidadeId`/`linha.unidadeId`
        // virava null sem nenhum aviso (quebrando filtros e relatórios por
        // unidade depois). Passa a contar e bloquear igual às demais.
        select: {
          _count: {
            select: { chamados: true, solicitacoes: true, solicitacoesPapelaria: true, colaboradores: true, linhas: true },
          },
        },
      });
      if (!unidade) return null;
      const { chamados, solicitacoes, solicitacoesPapelaria, colaboradores, linhas } = unidade._count;
      if (chamados === 0 && solicitacoes === 0 && solicitacoesPapelaria === 0 && colaboradores === 0 && linhas === 0) return null;
      const partes = [
        colaboradores > 0 ? `${colaboradores} colaborador(es)` : null,
        chamados > 0 ? `${chamados} chamado(s) de manutenção` : null,
        solicitacoes > 0 ? `${solicitacoes} solicitação(ões) de equipamento` : null,
        solicitacoesPapelaria > 0 ? `${solicitacoesPapelaria} solicitação(ões) de papelaria` : null,
        linhas > 0 ? `${linhas} linha(s) telefônica(s)` : null,
      ].filter(Boolean);
      return `Esta unidade tem ${partes.join(", ")} vinculado(s). Não é possível excluir enquanto existirem esses registros.`;
    },
  });

  // Diferente de Unidade: cargos.setorId é obrigatório com ON DELETE
  // RESTRICT (um Cargo não pode existir sem Setor) — excluir um Setor com
  // Cargos vinculados quebraria a integridade do banco. Por isso, aqui
  // bloqueia com 409 e orienta a mover/excluir os Cargos primeiro, em vez
  // de silenciosamente apagar cargos junto (o que perderia o vínculo de
  // colaboradores a esses cargos sem aviso nenhum).
  registrarDominioSimples(app, {
    path: "setores",
    model: "setor",
    entidade: "Setor",
    artigo: "um setor",
    naoEncontrada: "Setor não encontrado.",
    minNome: 2,
    temStatus: true,
    verificarUso: async (app, id) => {
      // Achado de auditoria (Ciclo de Evolução Contínua Nº 3, 10/07/2026):
      // mesmo gap do Unidade acima — Colaborador.setorId também é FK
      // opcional (SET NULL), então um setor com colaboradores vinculados
      // (mas sem Cargo próprio, caso raro porém possível) passava batido
      // por esta checagem.
      const setor = await app.prisma.setor.findUnique({
        where: { id },
        select: { _count: { select: { cargos: true, colaboradores: true } } },
      });
      if (!setor) return null;
      const { cargos, colaboradores } = setor._count;
      if (cargos === 0 && colaboradores === 0) return null;
      const partes = [
        cargos > 0 ? `${cargos} cargo(s)` : null,
        colaboradores > 0 ? `${colaboradores} colaborador(es) vinculado(s) diretamente ao setor` : null,
      ].filter(Boolean);
      return `Este setor tem ${partes.join(" e ")}. Exclua ou mova esses vínculos antes de excluir o setor.`;
    },
  });

  app.get("/cargos", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { setorId } = request.query as { setorId?: string };
    const cargos = await app.prisma.cargo.findMany({
      where: setorId ? { setorId } : undefined,
      orderBy: { nome: "asc" },
      include: { setor: true },
    });
    return reply.send(cargos);
  });

  app.post(
    "/cargos",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const parsed = z.object({ nome: z.string().min(2), setorId: z.string() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      // Achado de auditoria (06/07/2026): setorId era aceito sem checar se o
      // setor existe — um id inválido virava violação de FK (500 genérico)
      // em vez de mensagem clara.
      const setorExiste = await app.prisma.setor.findUnique({ where: { id: parsed.data.setorId } });
      if (!setorExiste) return reply.code(400).send({ error: "Setor não encontrado." });
      // Cargo.nome é único composto com setorId (@@unique([nome, setorId])),
      // não sozinho — por isso findFirst com os dois campos, não findUnique.
      const jaExiste = await app.prisma.cargo.findFirst({ where: { nome: parsed.data.nome, setorId: parsed.data.setorId } });
      if (jaExiste) return reply.code(409).send({ error: "Já existe um cargo com este nome neste setor." });
      const cargo = await app.prisma.cargo.create({ data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "Cargo", entidadeId: cargo.id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(201).send(cargo);
    }
  );

  app.patch(
    "/cargos/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ nome: z.string().min(2).optional(), setorId: z.string().optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const cargoAtual = await app.prisma.cargo.findUnique({ where: { id } });
      if (!cargoAtual) return reply.code(404).send({ error: "Cargo não encontrado." });
      if (parsed.data.setorId) {
        const setorExiste = await app.prisma.setor.findUnique({ where: { id: parsed.data.setorId } });
        if (!setorExiste) return reply.code(400).send({ error: "Setor não encontrado." });
      }
      if (parsed.data.nome || parsed.data.setorId) {
        const nomeChecar = parsed.data.nome ?? cargoAtual.nome;
        const setorChecar = parsed.data.setorId ?? cargoAtual.setorId;
        const jaExiste = await app.prisma.cargo.findFirst({ where: { nome: nomeChecar, setorId: setorChecar } });
        if (jaExiste && jaExiste.id !== id) return reply.code(409).send({ error: "Já existe um cargo com este nome neste setor." });
      }
      const cargo = await app.prisma.cargo.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "Cargo", entidadeId: id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.send(cargo);
    }
  );

  // Seguro: colaboradores.cargoId é opcional com ON DELETE SET NULL.
  app.delete(
    "/cargos/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const cargo = await app.prisma.cargo.findUnique({ where: { id } });
      if (!cargo) return reply.code(404).send({ error: "Cargo não encontrado." });
      await app.prisma.cargo.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "Cargo", entidadeId: id, detalhe: { nome: cargo.nome }, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(204).send();
    }
  );

  app.get("/empresas", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const empresas = await app.prisma.empresa.findMany({ orderBy: { razaoSocial: "asc" } });
    return reply.send(empresas);
  });

  app.post(
    "/empresas",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const parsed = empresaCreateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const razaoJaExiste = await app.prisma.empresa.findUnique({ where: { razaoSocial: parsed.data.razaoSocial } });
      if (razaoJaExiste) return reply.code(409).send({ error: "Já existe uma empresa com esta razão social." });
      if (parsed.data.cnpj) {
        const cnpjJaExiste = await app.prisma.empresa.findUnique({ where: { cnpj: parsed.data.cnpj } });
        if (cnpjJaExiste) return reply.code(409).send({ error: "Já existe uma empresa com este CNPJ." });
      }
      const empresa = await app.prisma.empresa.create({ data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "Empresa", entidadeId: empresa.id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(201).send(empresa);
    }
  );

  app.patch(
    "/empresas/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = empresaUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      if (parsed.data.razaoSocial) {
        const razaoJaExiste = await app.prisma.empresa.findUnique({ where: { razaoSocial: parsed.data.razaoSocial } });
        if (razaoJaExiste && razaoJaExiste.id !== id) return reply.code(409).send({ error: "Já existe uma empresa com esta razão social." });
      }
      if (parsed.data.cnpj) {
        const cnpjJaExiste = await app.prisma.empresa.findUnique({ where: { cnpj: parsed.data.cnpj } });
        if (cnpjJaExiste && cnpjJaExiste.id !== id) return reply.code(409).send({ error: "Já existe uma empresa com este CNPJ." });
      }
      const empresa = await app.prisma.empresa.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "Empresa", entidadeId: id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.send(empresa);
    }
  );

  // Seguro: linhas_telefonicas.empresaId é opcional com ON DELETE SET NULL.
  app.delete(
    "/empresas/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const empresa = await app.prisma.empresa.findUnique({ where: { id } });
      if (!empresa) return reply.code(404).send({ error: "Empresa não encontrada." });
      await app.prisma.empresa.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "Empresa", entidadeId: id, detalhe: { razaoSocial: empresa.razaoSocial }, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(204).send();
    }
  );

  // Diferente de Empresa/Cargo: acessos_sistema.sistemaId é obrigatório com
  // ON DELETE RESTRICT (um AcessoSistema não existe sem o sistema). Bloqueia
  // com 409 em vez de apagar os acessos concedidos junto — perder registro
  // de quem tinha acesso a quê, silenciosamente, seria pior que só avisar.
  registrarDominioSimples(app, {
    path: "sistemas-acesso",
    model: "sistemaAcesso",
    entidade: "SistemaAcesso",
    artigo: "um sistema de acesso",
    naoEncontrada: "Sistema não encontrado.",
    minNome: 2,
    temStatus: false,
    temDescricao: true,
    verificarUso: async (app, id) => {
      const sistema = await app.prisma.sistemaAcesso.findUnique({ where: { id }, select: { _count: { select: { acessos: true } } } });
      if (!sistema || sistema._count.acessos === 0) return null;
      return `Este sistema tem ${sistema._count.acessos} acesso(s) concedido(s). Remova os acessos antes de excluir o sistema.`;
    },
  });

  // Novas na Evolução Completa: dropdowns administráveis de Patrimônio.
  // Exclusão definitiva — corrige cadastro criado errado (ex: duplicado,
  // teste). Seguro por definição: categoriaId em Equipamento é opcional com
  // ON DELETE SET NULL (ver migration), então nenhum equipamento é apagado
  // ou fica em estado inconsistente — só perde a categorização.
  registrarDominioSimples(app, {
    path: "categorias-equipamento",
    model: "categoriaEquipamento",
    entidade: "CategoriaEquipamento",
    artigo: "uma categoria",
    naoEncontrada: "Categoria não encontrada.",
    minNome: 2,
    temStatus: true,
  });

  // Mesma observação de Categoria acima (marcaId em Equipamento é opcional
  // com ON DELETE SET NULL). `.min(1)` em vez de `.min(2)`: divergência já
  // existente antes desta refatoração (era assim mesmo nos 7 blocos
  // originais), sem justificativa documentada em nenhum commit/comentário
  // anterior. Preservada como estava — não é uma decisão de design desta
  // etapa, é comportamento já em produção que mudar seria uma alteração de
  // regra de negócio não solicitada (validação ficaria mais restritiva pra
  // marcas já cadastradas com nome de 1 caractere, se existir algum caso).
  registrarDominioSimples(app, {
    path: "marcas-equipamento",
    model: "marcaEquipamento",
    entidade: "MarcaEquipamento",
    artigo: "uma marca",
    naoEncontrada: "Marca não encontrada.",
    minNome: 1,
    temStatus: true,
  });

  // ---------------------------------------------------------------------
  // Papelaria e Compras (09/07/2026) — catálogo de categorias e produtos.
  // Diferente de Categoria/Marca de Equipamento (FK opcional, ON DELETE SET
  // NULL): aqui categoriaId é OBRIGATÓRIA tanto em ProdutoPapelaria quanto em
  // ItemSolicitacaoPapelaria (ON DELETE RESTRICT nos dois) — por isso a
  // checagem de uso antes de excluir, no mesmo padrão de Setor/SistemaAcesso
  // acima.
  // ---------------------------------------------------------------------
  registrarDominioSimples(app, {
    path: "categorias-produto-papelaria",
    model: "categoriaProdutoPapelaria",
    entidade: "CategoriaProdutoPapelaria",
    artigo: "uma categoria de produto",
    naoEncontrada: "Categoria não encontrada.",
    minNome: 2,
    temStatus: true,
    verificarUso: async (app, id) => {
      const categoria = await app.prisma.categoriaProdutoPapelaria.findUnique({
        where: { id },
        select: { _count: { select: { produtos: true, itens: true } } },
      });
      if (!categoria) return null;
      const { produtos, itens } = categoria._count;
      if (produtos === 0 && itens === 0) return null;
      const partes = [
        produtos > 0 ? `${produtos} produto(s) do catálogo` : null,
        itens > 0 ? `${itens} item(ns) de solicitação` : null,
      ].filter(Boolean);
      return `Esta categoria tem ${partes.join(" e ")} vinculado(s). Não é possível excluir enquanto existirem esses registros.`;
    },
  });

  // Catálogo de produtos — fora do molde genérico (igual Cargo acima) porque
  // tem FK obrigatória para categoria e um campo extra (unidade de medida
  // padrão) que os outros domínios simples não têm.
  app.get("/produtos-papelaria", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { categoriaId } = request.query as { categoriaId?: string };
    const produtos = await app.prisma.produtoPapelaria.findMany({
      where: categoriaId ? { categoriaId } : undefined,
      orderBy: { nome: "asc" },
      include: { categoria: true },
    });
    return reply.send(produtos);
  });

  const produtoPapelariaInputSchema = z.object({
    nome: z.string().min(2),
    categoriaId: z.string().min(1, "Selecione a categoria."),
    unidadeMedidaPadrao: z.nativeEnum(UnidadeMedidaProduto).default("UNIDADE"),
  });

  app.post(
    "/produtos-papelaria",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const parsed = produtoPapelariaInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const categoriaExiste = await app.prisma.categoriaProdutoPapelaria.findUnique({ where: { id: parsed.data.categoriaId } });
      if (!categoriaExiste) return reply.code(400).send({ error: "Categoria não encontrada." });
      const jaExiste = await app.prisma.produtoPapelaria.findUnique({ where: { nome: parsed.data.nome } });
      if (jaExiste) return reply.code(409).send({ error: "Já existe um produto com este nome." });
      const produto = await app.prisma.produtoPapelaria.create({ data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "ProdutoPapelaria", entidadeId: produto.id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(201).send(produto);
    }
  );

  app.patch(
    "/produtos-papelaria/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = produtoPapelariaInputSchema.partial().extend({ status: z.nativeEnum(StatusAtivoInativo).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const atual = await app.prisma.produtoPapelaria.findUnique({ where: { id } });
      if (!atual) return reply.code(404).send({ error: "Produto não encontrado." });
      if (parsed.data.categoriaId) {
        const categoriaExiste = await app.prisma.categoriaProdutoPapelaria.findUnique({ where: { id: parsed.data.categoriaId } });
        if (!categoriaExiste) return reply.code(400).send({ error: "Categoria não encontrada." });
      }
      if (parsed.data.nome) {
        const jaExiste = await app.prisma.produtoPapelaria.findUnique({ where: { nome: parsed.data.nome } });
        if (jaExiste && jaExiste.id !== id) return reply.code(409).send({ error: "Já existe um produto com este nome." });
      }
      const produto = await app.prisma.produtoPapelaria.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "ProdutoPapelaria", entidadeId: id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.send(produto);
    }
  );

  // Exclusão definitiva — segura por padrão? Não: produtoId em
  // ItemSolicitacaoPapelaria é ON DELETE SET NULL (ver schema), então excluir
  // um produto do catálogo não apaga nenhum item já solicitado, só solta o
  // vínculo (o item mantém `nomeProduto`/`categoriaId` snapshot). Por isso,
  // ao contrário da Categoria acima, não precisa bloquear por uso — mas
  // ainda restrito a ADMINISTRADOR por ser uma mudança de catálogo mestre.
  app.delete(
    "/produtos-papelaria/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const produto = await app.prisma.produtoPapelaria.findUnique({ where: { id } });
      if (!produto) return reply.code(404).send({ error: "Produto não encontrado." });
      await app.prisma.produtoPapelaria.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "ProdutoPapelaria", entidadeId: id, detalhe: { nome: produto.nome }, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(204).send();
    }
  );

  // ---------------------------------------------------------------------
  // Solicitação de Equipamentos (09/07/2026, pedido do Vini — "Ajuste na
  // Estrutura das Solicitações") — catálogo de categorias e produtos, mesmo
  // molde de Papelaria acima (produto tem FK obrigatória pra categoria, por
  // isso também fica fora do registrarDominioSimples 100% genérico). Único
  // ponto que diverge de Papelaria: SolicitacaoEquipamento.categoriaId/
  // produtoId são OPCIONAIS com ON DELETE SET NULL (ver comentário no
  // schema) — então excluir uma categoria nunca é bloqueada por
  // solicitações já feitas, só por produtos do catálogo ainda vinculados a
  // ela (FK obrigatória em ProdutoEquipamento.categoriaId, igual Papelaria).
  // ---------------------------------------------------------------------
  registrarDominioSimples(app, {
    path: "categorias-produto-equipamento",
    model: "categoriaProdutoEquipamento",
    entidade: "CategoriaProdutoEquipamento",
    artigo: "uma categoria de produto",
    naoEncontrada: "Categoria não encontrada.",
    minNome: 2,
    temStatus: true,
    verificarUso: async (app, id) => {
      const categoria = await app.prisma.categoriaProdutoEquipamento.findUnique({
        where: { id },
        select: { _count: { select: { produtos: true } } },
      });
      if (!categoria || categoria._count.produtos === 0) return null;
      return `Esta categoria tem ${categoria._count.produtos} produto(s) do catálogo vinculado(s). Não é possível excluir enquanto existirem esses registros.`;
    },
  });

  app.get("/produtos-equipamento", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { categoriaId } = request.query as { categoriaId?: string };
    const produtos = await app.prisma.produtoEquipamento.findMany({
      where: categoriaId ? { categoriaId } : undefined,
      orderBy: { nome: "asc" },
      include: { categoria: true },
    });
    return reply.send(produtos);
  });

  const produtoEquipamentoInputSchema = z.object({
    nome: z.string().min(2),
    categoriaId: z.string().min(1, "Selecione a categoria."),
  });

  app.post(
    "/produtos-equipamento",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const parsed = produtoEquipamentoInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const categoriaExiste = await app.prisma.categoriaProdutoEquipamento.findUnique({ where: { id: parsed.data.categoriaId } });
      if (!categoriaExiste) return reply.code(400).send({ error: "Categoria não encontrada." });
      const jaExiste = await app.prisma.produtoEquipamento.findUnique({ where: { nome: parsed.data.nome } });
      if (jaExiste) return reply.code(409).send({ error: "Já existe um produto com este nome." });
      const produto = await app.prisma.produtoEquipamento.create({ data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "ProdutoEquipamento", entidadeId: produto.id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(201).send(produto);
    }
  );

  app.patch(
    "/produtos-equipamento/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = produtoEquipamentoInputSchema.partial().extend({ status: z.nativeEnum(StatusAtivoInativo).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const atual = await app.prisma.produtoEquipamento.findUnique({ where: { id } });
      if (!atual) return reply.code(404).send({ error: "Produto não encontrado." });
      if (parsed.data.categoriaId) {
        const categoriaExiste = await app.prisma.categoriaProdutoEquipamento.findUnique({ where: { id: parsed.data.categoriaId } });
        if (!categoriaExiste) return reply.code(400).send({ error: "Categoria não encontrada." });
      }
      if (parsed.data.nome) {
        const jaExiste = await app.prisma.produtoEquipamento.findUnique({ where: { nome: parsed.data.nome } });
        if (jaExiste && jaExiste.id !== id) return reply.code(409).send({ error: "Já existe um produto com este nome." });
      }
      const produto = await app.prisma.produtoEquipamento.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "ProdutoEquipamento", entidadeId: id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.send(produto);
    }
  );

  // produtoId em SolicitacaoEquipamento é ON DELETE SET NULL (ver schema) —
  // excluir um produto do catálogo não apaga nenhuma solicitação já feita,
  // só solta o vínculo (a solicitação mantém o texto em `item` como
  // snapshot).
  app.delete(
    "/produtos-equipamento/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const produto = await app.prisma.produtoEquipamento.findUnique({ where: { id } });
      if (!produto) return reply.code(404).send({ error: "Produto não encontrado." });
      await app.prisma.produtoEquipamento.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "ProdutoEquipamento", entidadeId: id, detalhe: { nome: produto.nome }, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(204).send();
    }
  );

  // ---------------------------------------------------------------------
  // Catálogo de Acessórios de Patrimônio (17/07/2026, pedido do Vini: "cada
  // categoria tem que ter seus acessório próprio... por exemplo, apenas
  // celular ter o acessório capa") — mesmo molde de ProdutoPapelaria/
  // ProdutoEquipamento acima (FK obrigatória pra categoria), com UMA
  // diferença importante: lá `nome` é único GLOBALMENTE; aqui a unicidade é
  // composta (`nome`+`categoriaId`, ver @@unique no schema), porque o mesmo
  // termo ("Carregador", "Cabo USB") é um acessório legítimo de mais de uma
  // categoria — cada checagem de duplicidade abaixo usa a chave composta em
  // vez de só `nome`. Usa CategoriaEquipamento (patrimônio), não
  // CategoriaProdutoEquipamento (catálogo de pedido) — são conceitos
  // diferentes, ver comentário no schema.prisma.
  // ---------------------------------------------------------------------
  app.get("/acessorios-equipamento", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { categoriaId } = request.query as { categoriaId?: string };
    const acessorios = await app.prisma.acessorioEquipamento.findMany({
      where: categoriaId ? { categoriaId } : undefined,
      orderBy: [{ categoria: { nome: "asc" } }, { nome: "asc" }],
      include: { categoria: true },
    });
    return reply.send(acessorios);
  });

  const acessorioEquipamentoInputSchema = z.object({
    nome: z.string().min(2),
    categoriaId: z.string().min(1, "Selecione a categoria."),
  });

  app.post(
    "/acessorios-equipamento",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const parsed = acessorioEquipamentoInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const categoriaExiste = await app.prisma.categoriaEquipamento.findUnique({ where: { id: parsed.data.categoriaId } });
      if (!categoriaExiste) return reply.code(400).send({ error: "Categoria não encontrada." });
      const jaExiste = await app.prisma.acessorioEquipamento.findUnique({
        where: { nome_categoriaId: { nome: parsed.data.nome, categoriaId: parsed.data.categoriaId } },
      });
      if (jaExiste) return reply.code(409).send({ error: "Esta categoria já tem um acessório com este nome." });
      const acessorio = await app.prisma.acessorioEquipamento.create({ data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "CRIAR", entidade: "AcessorioEquipamento", entidadeId: acessorio.id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(201).send(acessorio);
    }
  );

  app.patch(
    "/acessorios-equipamento/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = acessorioEquipamentoInputSchema.partial().extend({ status: z.nativeEnum(StatusAtivoInativo).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      const atual = await app.prisma.acessorioEquipamento.findUnique({ where: { id } });
      if (!atual) return reply.code(404).send({ error: "Acessório não encontrado." });
      if (parsed.data.categoriaId) {
        const categoriaExiste = await app.prisma.categoriaEquipamento.findUnique({ where: { id: parsed.data.categoriaId } });
        if (!categoriaExiste) return reply.code(400).send({ error: "Categoria não encontrada." });
      }
      if (parsed.data.nome || parsed.data.categoriaId) {
        const nome = parsed.data.nome ?? atual.nome;
        const categoriaId = parsed.data.categoriaId ?? atual.categoriaId;
        const jaExiste = await app.prisma.acessorioEquipamento.findUnique({ where: { nome_categoriaId: { nome, categoriaId } } });
        if (jaExiste && jaExiste.id !== id) return reply.code(409).send({ error: "Esta categoria já tem um acessório com este nome." });
      }
      const acessorio = await app.prisma.acessorioEquipamento.update({ where: { id }, data: parsed.data });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "ATUALIZAR", entidade: "AcessorioEquipamento", entidadeId: id, ip: request.ip });
      avisarMudanca("dominios");
      return reply.send(acessorio);
    }
  );

  // acessorioId em EquipamentoAcessorio é ON DELETE RESTRICT (ver schema) —
  // ao contrário de ProdutoPapelaria/ProdutoEquipamento (SET NULL), excluir
  // um acessório do catálogo enquanto algum equipamento ainda o tem marcado
  // quebraria a integridade do vínculo (não existe "snapshot" de texto
  // aqui, é sempre uma referência viva). Bloqueia com a mesma mensagem
  // explicativa usada em Setor/SistemaAcesso (ver verificarUso do molde
  // genérico acima) em vez de deixar o Postgres estourar um erro de FK cru.
  app.delete(
    "/acessorios-equipamento/:id",
    { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const acessorio = await app.prisma.acessorioEquipamento.findUnique({
        where: { id },
        select: { nome: true, _count: { select: { equipamentos: true } } },
      });
      if (!acessorio) return reply.code(404).send({ error: "Acessório não encontrado." });
      if (acessorio._count.equipamentos > 0) {
        return reply.code(409).send({
          error: `${acessorio._count.equipamentos} equipamento(s) têm este acessório marcado. Desmarque nesses equipamentos antes de excluir do catálogo, ou apenas inative em vez de excluir.`,
        });
      }
      await app.prisma.acessorioEquipamento.delete({ where: { id } });
      await registrarAuditoria(app, { usuarioId: request.user.sub, acao: "EXCLUIR", entidade: "AcessorioEquipamento", entidadeId: id, detalhe: { nome: acessorio.nome }, ip: request.ip });
      avisarMudanca("dominios");
      return reply.code(204).send();
    }
  );
}
