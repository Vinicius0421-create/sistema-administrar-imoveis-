# Administrar Imóveis — contexto para o Claude Code

Este arquivo existe para que qualquer sessão do Claude Code que abra este repositório
comece com o contexto que já foi construído ao longo de várias sessões anteriores
(Cowork), em vez de redescobrir tudo do zero. Leia antes de propor mudanças estruturais.

## O que é este projeto

Sistema interno de gestão da **Administrar Imóveis** (Grupo EXP, atuação em
Itaúna/Itatiaiuçu/Igarapé-MG): colaboradores, equipamentos/patrimônio, linhas
telefônicas, acessos a sistemas, chamados de suporte/TI, solicitações de compra
(equipamento, papelaria, serviço), movimentações de colaborador, central de
mensagens e notificações. Uso interno da empresa — não é produto vendido a terceiros.

## Arquitetura

```
sistema-administrar-imoveis-/
├── backend/    Node + TypeScript + Fastify 5 + Prisma 5 + PostgreSQL
└── frontend/   React 18 + TypeScript + Vite + Tailwind
```

- **Backend**: monolito modular por arquivo de rota (`src/routes/*.routes.ts`),
  registrado em `src/server.ts`. Autenticação JWT (access curto + refresh opaco
  rotativo com família revogável), guardado só em memória no navegador. RBAC via
  enum `Papel` (`ADMINISTRADOR`, `GESTOR_COORDENADOR`, `SUPORTE_TI`, `COLABORADOR`,
  `RH`, `FINANCEIRO`) checado por rota com `app.requireRole(...)` — nunca inferido
  do lado do cliente.
- **Frontend**: SPA de tela única. **Não usa react-router** — troca de página é
  feita por estado local em `App.tsx` com `React.lazy()` por módulo. Isso é uma
  limitação conhecida, não um acidente a "corrigir sem avisar": ver seção
  "Roadmap" abaixo antes de mexer nisso.
- **Banco**: PostgreSQL puro via Prisma. **Sem RLS, sem multi-tenancy** — é
  intencional (uso de uma única empresa). Não introduza isolamento multi-tenant
  sem essa ser uma decisão de negócio explícita.
- **Deploy**: Railway (backend, `railway up` manual) + Vercel (frontend,
  `vercel --prod` manual). **Deliberadamente sem CI/CD automático via GitHub** —
  ver "Incidente 03–06/08/2026" abaixo antes de propor reconectar isso.

## Regras que já foram estabelecidas e devem ser respeitadas

- **Nunca commitar segredos**: `.env` real, tokens, chaves de API, credenciais,
  dumps de banco, dados pessoais reais. Os `.gitignore` de `backend/` e
  `frontend/` já cobrem os arquivos certos — não remova essas linhas.
- **Nunca conectar o serviço Railway a um repositório GitHub sem confirmação
  explícita do dono do projeto.** Foi exatamente esse tipo de conexão acidental
  (apontando para um repositório pessoal errado) que causou uma indisponibilidade
  real do sistema em produção entre 03–06/08/2026.
- **Nunca `git push --force` / `git push -f`** neste repositório.
- **Não reative nem reimplemente o módulo de Pagamentos/CNAB240** sem pedido
  explícito — está desativado de propósito (rotas `.disabled`, models fora do
  schema ativo) enquanto não é reconciliado com o que roda em produção.
- Este código do backend/frontend foi **recuperado por mineração de transcrições
  de sessão e pela API da Vercel** (não é um clone direto da produção real).
  Está ~99% funcional, mas: só há 2 migrations Prisma versionadas aqui contra um
  schema de produção real que tem histórico mais extenso; o job de aniversariantes
  e a geração de PDF do termo de responsabilidade têm lacunas conhecidas. **Antes
  de fazer deploy deste código por cima da produção real**, reconciliar as
  migrations rodando `prisma migrate dev` contra um banco de teste que espelhe
  o schema real de produção.

## Comandos de validação

Rodar antes de considerar qualquer mudança pronta:

```bash
# Backend
cd backend
npm run typecheck        # tsc --noEmit
npx prisma validate      # exige DATABASE_URL setada (pode ser fake para só validar sintaxe)

# Frontend
cd frontend
npm run typecheck        # tsc --noEmit
npm run build             # build de produção completo (também roda typecheck)
```

Não existe `lint` nem `test` configurado em nenhum dos dois `package.json` hoje —
não assuma que existe, não invente um comando que não está lá.

## Módulos existentes (não duplicar)

Colaboradores, Equipamentos/Patrimônio, Linhas Telefônicas, Acessos a Sistemas,
Chamados (suporte/TI), Solicitações de Equipamento, Solicitações de Serviço,
Papelaria/Compras, Movimentações de Colaborador (já cobre admissão/desligamento/
transferência/promoção), Mensagens/Central de Comunicação, Notificações
(sistema genérico e extensível, ver `Notificacao`/`CategoriaNotificacao`/
`TipoNotificacao` no `schema.prisma`), Auditoria (`AuditLog`, genérico:
usuário/ação/entidade/detalhe JSON/IP).

## Roadmap em andamento

Existe uma análise de arquitetura completa (diagnóstico + arquitetura recomendada
+ roadmap priorizado para evolução do sistema em uma plataforma corporativa
modular, começando por um módulo de RH/Ponto) — ver
`claude/Diagnostico_Arquitetura_Plataforma_Corporativa_11-08-2026.md` no projeto
Claude "Administrar Imóveis" (Cowork). Pontos centrais dessa análise:

1. Introduzir `react-router` real no frontend e paginação nas listagens do
   backend **antes** de adicionar módulos novos (RH, Ponto) — pré-requisito
   técnico, não só recomendação de estilo.
2. RH deve **estender** `Colaborador`/`Setor`/`Cargo`/`Unidade` existentes, não
   duplicar cadastro.
3. Controle de ponto: não implementar reconhecimento facial sem validação
   jurídica prévia (LGPD) — preferir WebAuthn/passkey + IP como sinal auxiliar
   + dispositivo autorizado.

## Histórico deste repositório

Monorepo criado em 11/08/2026 combinando dois repositórios locais (backend
`e13e7bc`, frontend `733ae8f`) via `git subtree`, preservando o histórico de
cada um dentro de `backend/` e `frontend/` respectivamente.
