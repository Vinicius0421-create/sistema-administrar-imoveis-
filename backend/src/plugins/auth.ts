import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Papel } from "@prisma/client";
import { env } from "../env";

export type AuthPayload = {
  sub: string; // usuarioId
  papel: Papel;
  colaboradorId: string | null;
  precisaTrocarSenha: boolean;
};

// Rotas acessíveis mesmo com troca de senha pendente — o suficiente para o
// frontend mostrar "quem é você" e deixar a pessoa definir a própria senha,
// nada além disso.
const ROTAS_PERMITIDAS_COM_TROCA_PENDENTE = new Set(["/auth/me", "/auth/senha", "/auth/logout"]);

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...papeis: Papel[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthPayload;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
  });

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Token ausente ou inválido." });
    }

    const caminho = request.url.split("?")[0] ?? request.url;
    if (request.user.precisaTrocarSenha && !ROTAS_PERMITIDAS_COM_TROCA_PENDENTE.has(caminho)) {
      return reply.code(403).send({
        error: "Troca de senha obrigatória antes de continuar.",
        codigo: "SENHA_TROCA_OBRIGATORIA",
      });
    }
  });

  // Uso: { preHandler: [app.authenticate, app.requireRole("ADMINISTRADOR")] }
  // Aplicado por rota — nunca inferido do lado do cliente, ao contrário do
  // seletor "Ver como" do protótipo original.
  app.decorate("requireRole", (...papeis: Papel[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "Não autenticado." });
      }
      if (!papeis.includes(request.user.papel)) {
        return reply.code(403).send({
          error: "Você não tem permissão para executar esta ação.",
          papelNecessario: papeis,
          papelAtual: request.user.papel,
        });
      }
    };
  });
});
