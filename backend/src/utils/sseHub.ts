import type { FastifyReply } from "fastify";

// RECONSTRUÍDO 07/08/2026 — o arquivo original não foi encontrado em
// nenhuma transcrição desta sessão (só sobreviveram os pontos de uso em
// notificacoes.routes.ts, notificacoes.service.ts e realtime.ts, todos
// mantidos verbatim). Reconstruído a partir do contrato exato exigido por
// esses três chamadores:
//   - registrarConexao(usuarioId, reply) / removerConexao(usuarioId, reply)
//     — chamadas em notificacoes.routes.ts na rota GET /notificacoes/stream,
//     com `reply` já "hijacked" (reply.raw é o stream SSE em aberto).
//   - enviarParaUsuario(usuarioId, evento, dados) — notificacoes.service.ts,
//     empurra notificação só pra quem ela é destinada.
//   - enviarParaTodos(evento, dados) — realtime.ts (avisarMudanca), broadcast
//     de "dados mudaram" pra toda conexão aberta, de qualquer usuário.
// Um usuário pode ter mais de uma aba/dispositivo conectado ao mesmo tempo
// (Set por usuarioId, não uma única reply) — sem isso, abrir o sistema em
// duas abas derrubaria o SSE de uma delas.
//
// ⚠️ Reconstrução, não recuperação verbatim — revisar antes de confiar 100%
// em produção. Ver Recuperacao_Codigo_Fonte_07-08-2026.md.

const conexoesPorUsuario = new Map<string, Set<FastifyReply>>();

export function registrarConexao(usuarioId: string, reply: FastifyReply): void {
  let conexoes = conexoesPorUsuario.get(usuarioId);
  if (!conexoes) {
    conexoes = new Set();
    conexoesPorUsuario.set(usuarioId, conexoes);
  }
  conexoes.add(reply);
}

export function removerConexao(usuarioId: string, reply: FastifyReply): void {
  const conexoes = conexoesPorUsuario.get(usuarioId);
  if (!conexoes) return;
  conexoes.delete(reply);
  if (conexoes.size === 0) conexoesPorUsuario.delete(usuarioId);
}

function escreverEvento(reply: FastifyReply, evento: string, dados: unknown): void {
  try {
    reply.raw.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
  } catch {
    // Conexão já fechada/quebrada — o listener de "close" da rota cuida de
    // remover do mapa; aqui só evita que um write falho derrube o handler
    // que disparou o evento (ex: uma escrita no banco que já foi commitada).
  }
}

export function enviarParaUsuario(usuarioId: string, evento: string, dados: unknown): void {
  const conexoes = conexoesPorUsuario.get(usuarioId);
  if (!conexoes) return;
  for (const reply of conexoes) escreverEvento(reply, evento, dados);
}

export function enviarParaTodos(evento: string, dados: unknown): void {
  for (const conexoes of conexoesPorUsuario.values()) {
    for (const reply of conexoes) escreverEvento(reply, evento, dados);
  }
}
