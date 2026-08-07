# University Administrar

Plataforma de educação, capacitação e acompanhamento de treinamentos dos
colaboradores. Módulo standalone (Next.js 16 + Supabase) — não depende de
nenhum sistema externo, mas foi desenhado para futuramente se integrar a um
CRM/ERP via API (ex.: sincronizar desligamento de colaboradores).

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind v4 + shadcn/ui
- Supabase (Postgres + Auth + Row Level Security)

## Configuração

1. Crie um projeto no [Supabase](https://supabase.com).
2. Rode as migrations em `supabase/migrations/` na ordem numérica (via SQL
   Editor do painel Supabase, ou `supabase db push` se estiver usando a CLI
   com o projeto linkado).
3. Copie `.env.example` para `.env.local` e preencha com a URL e a anon key
   do seu projeto Supabase.
4. Crie o primeiro usuário admin: cadastre-se normalmente pela tela de login
   (isso cria a linha em `profiles` com role `colaborador`) e depois promova
   manualmente via SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'voce@empresa.com';
   ```
   Promoções seguintes podem ser feitas pela própria tela
   `/admin/colaboradores`.
5. `npm install && npm run dev`.

## Arquitetura

- **Isolamento de dados**: tabelas compartilhadas com `user_id` + Row Level
  Security (não bancos físicos por usuário — ver comentários em
  `supabase/migrations/0003_rls.sql`).
- **Autenticação**: Supabase Auth. `src/proxy.ts` faz a checagem otimista de
  sessão (padrão Next.js 16 — substitui o antigo `middleware.ts`);
  `src/lib/dal.ts` é a linha de defesa real, checada em toda leitura de dados
  sensíveis, inclusive o campo `status` do colaborador (desligamento
  automático).
- **Progresso e quiz**: corrigidos e calculados sempre no servidor (ver
  `src/app/actions/quiz.ts` e `src/lib/queries/trainings.ts` +
  `supabase/migrations/0004_progress_view.sql`) — o client nunca recebe o
  gabarito nem decide sozinho se algo foi concluído.

## Próximos passos (fora do escopo desta primeira versão)

- Ranking de desempenho dedicado.
- Limite/múltiplas tentativas de quiz configuráveis por treinamento (a
  estrutura de dados já suporta; falta a regra de negócio e a UI).
- Integração real com um CRM externo (webhook de desligamento em vez de
  toggle manual em `/admin/colaboradores`).
- Testes automatizados de RLS e dos fluxos principais.
