import { FastifyInstance } from "fastify";
import { notificar, notificarPorPapeis } from "./notificacoes.service";
import { avisarMudanca } from "./realtime";

// Job de vencimento de documentos (11/08/2026, Fase RH da Evolução
// Completa). Cobre o pedido #6 do escopo: detectar documento vencido/
// próximo do vencimento e notificar automaticamente, sem depender de
// alguém lembrar de verificar manualmente.
//
// Roda em processo (setInterval), mesmo padrão já usado no projeto para
// jobs periódicos simples (ver histórico de aniversariosJob.ts, hoje
// desativado por outro motivo) — não introduz infra nova (fila, cron
// externo) para um volume de dados que ainda é pequeno; reavaliar se o
// número de documentos crescer muito.
//
// Duas responsabilidades, sempre nesta ordem a cada execução:
//   1) Expirar documentos APROVADOS cuja dataValidade já passou.
//   2) Alertar (sem mudar status) documentos que vencem dentro de um dos
//      limiares configurados em TipoDocumento.diasAntecedenciaAlerta,
//      evitando duplicar o mesmo alerta (DocumentoColaborador.
//      alertasVencimentoEnviados guarda os limiares já notificados).
const INTERVALO_MS = 6 * 60 * 60 * 1000; // a cada 6h

export function iniciarAgendadorVencimentoDocumentos(app: FastifyInstance): void {
  const executar = () => verificarVencimentos(app).catch((err) => app.log.error({ err }, "Falha no job de vencimento de documentos"));

  // Roda uma vez pouco depois do boot (dá tempo do Prisma conectar) e
  // depois no intervalo fixo — mesmo padrão de heartbeat usado em
  // notificacoes.routes.ts (SSE), só que em escala de horas, não segundos.
  setTimeout(executar, 30_000);
  setInterval(executar, INTERVALO_MS);
}

async function verificarVencimentos(app: FastifyInstance): Promise<void> {
  await expirarVencidos(app);
  await alertarProximosDoVencimento(app);
}

async function expirarVencidos(app: FastifyInstance): Promise<void> {
  const vencidos = await app.prisma.documentoColaborador.findMany({
    where: { status: "APROVADO", dataValidade: { lt: new Date() } },
    include: { colaborador: { select: { nomeCompleto: true } }, tipoDocumento: { select: { nome: true } } },
  });
  if (vencidos.length === 0) return;

  for (const doc of vencidos) {
    await app.prisma.documentoColaborador.update({ where: { id: doc.id }, data: { status: "EXPIRADO" } });
    await app.prisma.documentoColaboradorEvento.create({
      data: { documentoId: doc.id, tipo: "EXPIRADO", detalhe: { dataValidade: doc.dataValidade } },
    });
    await notificarPorPapeis(app, ["ADMINISTRADOR", "RH"], {
      categoria: "DOCUMENTO",
      tipo: "DOCUMENTO_VENCIDO",
      titulo: "Documento vencido",
      mensagem: `"${doc.tipoDocumento.nome}" de ${doc.colaborador.nomeCompleto} venceu.`,
      prioridade: "ALTA",
      entidade: "DocumentoColaborador",
      entidadeId: doc.id,
    });
  }

  avisarMudanca("documentos");
  app.log.info({ quantidade: vencidos.length }, "Documentos expirados pelo job de vencimento");
}

async function alertarProximosDoVencimento(app: FastifyInstance): Promise<void> {
  const maiorHorizonteDias = 30; // maior valor de diasAntecedenciaAlerta esperado — corta a busca inicial
  const limiteBusca = new Date(Date.now() + maiorHorizonteDias * 24 * 60 * 60 * 1000);

  const candidatos = await app.prisma.documentoColaborador.findMany({
    where: { status: "APROVADO", dataValidade: { gte: new Date(), lte: limiteBusca } },
    include: {
      colaborador: { select: { nomeCompleto: true } },
      tipoDocumento: { select: { nome: true, diasAntecedenciaAlerta: true } },
    },
  });
  if (candidatos.length === 0) return;

  const agora = Date.now();

  for (const doc of candidatos) {
    if (!doc.dataValidade) continue;
    const diasRestantes = Math.ceil((doc.dataValidade.getTime() - agora) / (24 * 60 * 60 * 1000));

    // Limiar certo = o maior limiar configurado que já foi alcançado
    // (diasRestantes <= limiar) e que ainda não foi notificado — evita
    // mandar 4 notificações de uma vez se o job ficar parado um tempo e
    // "pular" limiares intermediários.
    const limiaresAlcancados = doc.tipoDocumento.diasAntecedenciaAlerta
      .filter((limiar) => diasRestantes <= limiar)
      .sort((a, b) => b - a);
    const proximoLimiar = limiaresAlcancados.find((limiar) => !doc.alertasVencimentoEnviados.includes(limiar));
    if (proximoLimiar === undefined) continue;

    await app.prisma.documentoColaborador.update({
      where: { id: doc.id },
      data: { alertasVencimentoEnviados: { push: proximoLimiar } },
    });
    await app.prisma.documentoColaboradorEvento.create({
      data: {
        documentoId: doc.id,
        tipo: "ALERTA_VENCIMENTO",
        detalhe: { diasRestantes, limiar: proximoLimiar },
      },
    });

    const mensagem = `"${doc.tipoDocumento.nome}" de ${doc.colaborador.nomeCompleto} vence em ${diasRestantes} dia${diasRestantes === 1 ? "" : "s"}.`;
    await notificarPorPapeis(app, ["ADMINISTRADOR", "RH"], {
      categoria: "DOCUMENTO",
      tipo: "DOCUMENTO_VENCENDO",
      titulo: "Documento próximo do vencimento",
      mensagem,
      prioridade: proximoLimiar <= 7 ? "ALTA" : "MEDIA",
      entidade: "DocumentoColaborador",
      entidadeId: doc.id,
    });

    const usuarioColaborador = await app.prisma.usuario.findUnique({ where: { colaboradorId: doc.colaboradorId } });
    if (usuarioColaborador) {
      await notificar(app, {
        destinatarioIds: [usuarioColaborador.id],
        categoria: "DOCUMENTO",
        tipo: "DOCUMENTO_VENCENDO",
        titulo: "Seu documento está vencendo",
        mensagem,
        prioridade: proximoLimiar <= 7 ? "ALTA" : "MEDIA",
        entidade: "DocumentoColaborador",
        entidadeId: doc.id,
      });
    }
  }

  avisarMudanca("documentos");
}
