# Administrar Imóveis — Backend

Backend do sistema organizacional interno (colaboradores, equipamentos, linhas
telefônicas, acessos a sistemas, solicitações, chamados de manutenção,
movimentações e histórico de trocas), construído para substituir o protótipo
`sistema-administrar-imoveis.jsx` — que rodava inteiramente no navegador, sem
banco de dados real, sem autenticação de verdade e com dados pessoais (CPF,
telefone) hardcoded no código-fonte.

Stack: **Node.js + TypeScript + Fastify + PostgreSQL + Prisma**.

## Por que este backend existe

O protótipo `.jsx` era um artifact React que só funcionava dentro do preview
do Claude.ai, persistindo dados em `window.storage` (API de sandbox, não um
banco de verdade) e usando um `<select>` de "Ver como: Administrador/Gestor/
Suporte/Colaborador" como controle de acesso — ou seja, qualquer pessoa com o
link podia se autopromover a Administrador. Este backend resolve isso:

- **Banco real** (PostgreSQL) em vez de storage de artifact.
- **Autenticação JWT + RBAC** aplicada no servidor (ver `src/plugins/auth.ts`),
  não mais um seletor client-side.
- **CPF mascarado por padrão** nas respostas de API, com o valor completo
  liberado só para papéis autorizados e sempre registrado em auditoria
  (`AuditLog`).
- **Sem PII no código-fonte**: os dados reais de colaboradores entram via
  `npm run import:csv`, lendo de `prisma/import/`, pasta que está no
  `.gitignore` — nunca commitada.
- **Histórico de trocas gerado automaticamente** pelas rotas de Equipamentos,
  em vez de depender de alguém preencher manualmente (era esse o motivo do
  módulo equivalente na planilha original nunca ter dado certo).

## Requisitos

- Node.js 20+
- PostgreSQL 14+ (local, Docker, ou um serviço gerenciado como Railway/Neon/RDS)

## Setup

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# edite .env: DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (gere
# valores fortes com `openssl rand -hex 64`), SEED_ADMIN_EMAIL/PASSWORD

# 3. Gerar o client do Prisma e aplicar o schema no banco
npx prisma generate
npx prisma migrate dev --name init

# 4. Popular tabelas de domínio + usuário administrador inicial
npm run seed

# 5. (opcional) Importar os dados reais de colaboradores/ativos
#    Baixe os CSVs do projeto (05_Colaboradores.csv, 06_Equipamentos.csv...)
#    e coloque em prisma/import/ com os mesmos nomes de arquivo.
npm run import:csv

# 6. Subir o servidor em modo desenvolvimento
npm run dev
```

O servidor sobe em `http://localhost:3333` por padrão (`PORT` no `.env`).
`GET /health` confirma que está no ar.

> **Nota sobre este ambiente de geração**: este código foi escrito num
> sandbox com política de rede restrita, que bloqueia o download dos
> binários de engine do Prisma (`binaries.prisma.sh` não está na allowlist).
> Por isso `npx prisma generate` e `npx prisma validate` não puderam ser
> executados aqui para validar o schema automaticamente. O schema foi escrito
> e revisado manualmente com cuidado, mas **rode `npx prisma generate` e
> `npm run typecheck` como primeiro passo no seu ambiente** antes de seguir
> em frente — é a verificação que faltou fazer aqui.

## Scripts disponíveis

| Script | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor com reload automático (tsx watch) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda a versão compilada (produção) |
| `npm run typecheck` | Só verifica tipos, sem gerar arquivos |
| `npm run prisma:migrate` | Cria/aplica uma nova migration a partir do schema |
| `npm run prisma:studio` | Abre o Prisma Studio (GUI para inspecionar o banco) |
| `npm run seed` | Popula domínio + usuário administrador |
| `npm run import:csv` | Importa colaboradores/ativos reais a partir de `prisma/import/*.csv` |

## Estrutura de pastas

```
prisma/
  schema.prisma       # modelo de dados completo (17 tabelas)
  seed.ts             # domínio + usuário admin (sem PII)
  import-csv.ts       # importador único dos dados reais (lê prisma/import/)
  import/              # (gitignored) coloque aqui os CSVs reais
src/
  env.ts               # validação das variáveis de ambiente com zod
  server.ts             # bootstrap do Fastify, registro de plugins e rotas
  plugins/
    prisma.ts          # decora fastify.prisma
    auth.ts             # JWT + requireRole (RBAC)
  routes/
    auth.routes.ts               # login, refresh, logout, /me
    colaboradores.routes.ts
    equipamentos.routes.ts       # inclui devolução ao estoque
    linhas.routes.ts
    acessos.routes.ts
    lotes.routes.ts
    solicitacoes.routes.ts       # fluxo kanban de aprovação
    chamados.routes.ts           # fluxo kanban de suporte
    movimentacoes.routes.ts
    historico.routes.ts          # somente leitura — gerado automaticamente
    dominios.routes.ts           # unidades/setores/cargos/empresas/sistemas (somente leitura)
  utils/
    cpf.ts               # validação e máscara de CPF
    tokens.ts             # geração/hash de refresh token opaco
    audit.ts               # gravação de log de auditoria
    pagination.ts
```

## Papéis e permissões (RBAC)

| Papel | Pode ver | Pode escrever |
|---|---|---|
| `ADMINISTRADOR` | Tudo, incluindo CPF completo | Tudo |
| `GESTOR_COORDENADOR` | Tudo, incluindo CPF completo | Colaboradores, aprovar/reprovar solicitações |
| `SUPORTE_TI` | Tudo (CPF mascarado) | Equipamentos, linhas, acessos, chamados |
| `COLABORADOR` | Só os próprios chamados/solicitações (CPF mascarado) | Só abrir chamado/solicitação em nome próprio |

A regra é sempre aplicada no servidor (`app.requireRole(...)` em cada rota) —
nunca no cliente. Isso é o que faltava no protótipo.

## Autenticação

- `POST /auth/login` → `{ accessToken, refreshToken, usuario }`. Rate limit de
  10 tentativas/minuto por IP.
- `POST /auth/refresh` → rotaciona o refresh token (revoga o antigo, emite um
  novo) e devolve um novo access token.
- `POST /auth/logout` → revoga o refresh token informado.
- `GET /auth/me` (autenticado) → dados do usuário logado.

O access token é um JWT de vida curta (15 min por padrão); o refresh token é
opaco (não é JWT), guardado no banco só como hash SHA-256, o que permite
revogar sessões individualmente sem precisar de blacklist.

## Próximos passos recomendados

1. Rodar `npx prisma generate` + `npm run typecheck` no seu ambiente (ver nota
   acima) e corrigir qualquer erro de tipo que o sandbox não pôde revelar.
2. Escrever testes automatizados (Vitest + Supertest é uma boa combinação com
   Fastify) cobrindo pelo menos os fluxos de autenticação e RBAC.
3. Adicionar CI (GitHub Actions) rodando `typecheck`, `prisma validate` e os
   testes a cada push.
4. Decidir hospedagem do banco (Railway, Neon, RDS) e do servidor (Railway,
   Render, Fly.io ou um VPS com Docker).
5. ~~Construir o frontend real consumindo esta API~~ — feito, ver
   `administrar-imoveis-frontend/` (Vite + React + TypeScript). Consome todos
   os endpoints abaixo, incluindo `/unidades`, `/setores`, `/cargos`,
   `/empresas` e `/sistemas-acesso`, que foram adicionados especificamente
   para alimentar os selects do frontend (o protótipo original guardava essas
   listas soltas em `dominios`; aqui elas são tabelas relacionais de verdade).
