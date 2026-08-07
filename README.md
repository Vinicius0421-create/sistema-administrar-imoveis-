# Administrar Imóveis — Frontend

Frontend real do sistema organizacional interno, construído para substituir
de vez o protótipo `sistema-administrar-imoveis.jsx` (que rodava só dentro do
artifact do Claude.ai, com `window.storage` e um seletor "Ver como" fake).
Consome a API do `administrar-imoveis-backend` via HTTP.

Stack: **Vite + React 18 + TypeScript + Tailwind CSS**.

## O que mudou em relação ao protótipo

- **Autenticação real**: tela de login chama `POST /auth/login`; o papel do
  usuário vem do JWT devolvido pela API, não de um `<select>` no navegador.
  Qualquer pessoa com o link não consegue mais virar Administrador sozinha.
- **Tokens só em memória**: nunca em `localStorage`/`sessionStorage` — ver
  comentário em `src/lib/apiClient.ts`. Consequência aceita: recarregar a
  página (F5) exige login de novo. É reversível (trocar por refresh token em
  cookie httpOnly) se a equipe preferir persistência entre recargas.
- **Dados relacionais, não strings soltas**: `setor`, `unidade`, `cargo`,
  `empresa` e `sistema de acesso` agora são tabelas de verdade
  (`/setores`, `/unidades`, `/cargos`, `/empresas`, `/sistemas-acesso`), não
  arrays fixos dentro do próprio front. Os formulários usam os IDs dessas
  tabelas.
- **Portal do Colaborador sem seletor de identidade**: no protótipo, a
  pessoa escolhia "Você é: [nome]" em um `<select>` — qualquer um podia abrir
  chamado ou solicitação em nome de outro colaborador. Agora o
  `colaboradorId` vem do próprio token JWT de quem fez login.
- **CPF mascarado por padrão**: a API já devolve o CPF mascarado para quem
  não tem permissão de ver o valor completo; o formulário de edição detecta
  isso e não reenvia o valor mascarado como se fosse o CPF real.
- **Histórico de Trocas é 100% somente leitura**: gerado automaticamente
  pelo backend quando um equipamento muda de colaborador — não existe (nem
  precisa existir) tela de cadastro manual.

## Diferenças conscientes de escopo (não são bugs)

- O campo livre "Responsável (TI)" do formulário de Chamados foi removido: no
  modelo relacional, `responsavelId` é atribuído pelo backend quando alguém
  de Suporte/TI ou Admin muda o status do chamado — não é mais um texto
  digitado à mão.
- A tela de Movimentações registra o evento (Admissão, Desligamento,
  Transferência, Promoção), mas — igual ao protótipo original — não desativa
  automaticamente o colaborador quando o tipo é "Desligamento". Para isso
  existe uma ação dedicada no backend (`POST /colaboradores/:id/desligar`)
  que ainda não tem botão na UI; é um bom próximo passo se o fluxo de
  desligamento precisar ser único (movimentação + status, atômico).
- Não há tela de cadastro de Lotes de Rateio — igual ao protótipo, lotes só
  aparecem como filtro/seleção dentro de Solicitações.

## Setup

```bash
# 1. Instalar dependências
npm install

# 2. Configurar a URL da API
cp .env.example .env
# edite .env: VITE_API_URL=http://localhost:3333 (ou a URL de produção do backend)

# 3. Rodar em desenvolvimento
npm run dev
# abre em http://localhost:5173

# 4. Build de produção
npm run build
# gera dist/ — qualquer hosting de estáticos (Vercel, Netlify, etc.) serve essa pasta
```

## Verificação incluída

Este projeto já foi validado nestes dois níveis, sem depender de um
navegador real (o ambiente onde foi gerado tem acesso de rede restrito a
Chromium):

1. `npm run typecheck` — 0 erros de TypeScript.
2. `npm run build` — build de produção do Vite concluído com sucesso
   (bundle final ~220KB / ~70KB gzip).
3. `node scripts/smoke-test.mjs` — monta os módulos reais (`App.tsx`,
   `AuthContext.tsx`, etc., não uma cópia) em um DOM simulado (jsdom) com
   `fetch` mockado, simula login e confirma que: a tela de login renderiza,
   o formulário envia e-mail/senha, o shell autenticado aparece com o papel
   correto, e todos os 9 recursos + 5 tabelas de domínio são buscados nos
   endpoints certos — tudo sem nenhum erro de console.

Isso cobre o que dá para verificar sem um navegador de verdade. Depois do
deploy real, vale um teste manual do fluxo de login → CRUD de colaborador →
logout antes de liberar para a equipe.

## Estrutura de pastas

```
src/
  api/            # um arquivo por recurso, espelhando as rotas do backend
  auth/           # AuthContext (login/logout/estado do usuário)
  components/     # UI compartilhada (Button, Modal, KanbanBoard, ícones...)
  hooks/          # useAppData — busca todos os recursos ao entrar no sistema
  lib/            # apiClient (fetch + JWT + refresh automático)
  pages/          # uma página por módulo do sistema
  types.ts        # tipos + enums + rótulos em português, espelhando o schema.prisma
```

## Próximos passos recomendados

1. Apontar `VITE_API_URL` para o backend rodando em produção (ver o plano de
   implantação entregue separadamente).
2. Testar manualmente com um usuário de cada papel (Admin, Gestor, Suporte
   TI, Colaborador) antes de liberar para a equipe.
3. Se decidir manter sessão entre recargas de página, avaliar migrar o
   refresh token para cookie httpOnly (exige um pequeno ajuste no backend).
4. Adicionar testes de componente (Vitest + Testing Library) para os
   formulários mais usados (Colaboradores, Equipamentos).
