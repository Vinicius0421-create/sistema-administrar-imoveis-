import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

type AuditInput = {
  usuarioId?: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  detalhe?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Grava um evento de auditoria sem nunca derrubar a requisição principal —
 * falha de log não pode virar erro 500 para quem só queria ler um cadastro.
 */
export async function registrarAuditoria(app: FastifyInstance, input: AuditInput): Promise<void> {
  try {
    await app.prisma.auditLog.create({
      data: {
        usuarioId: input.usuarioId ?? null,
        acao: input.acao,
        entidade: input.entidade,
        entidadeId: input.entidadeId ?? null,
        detalhe: input.detalhe as Prisma.InputJsonValue | undefined,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    app.log.error({ err }, "Falha ao registrar log de auditoria");
  }
}
