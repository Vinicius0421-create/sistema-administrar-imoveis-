import { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../env";
import { generateRefreshToken, hashToken } from "../utils/tokens";
import { registrarAuditoria } from "../utils/audit";
import { enviarEmail, templateRedefinicaoSenha } from "../utils/email";
import { normalizarEmail } from "../utils/validacao";

const loginSchema = z.object({
  // Padronização Global (Fase 3, 09/07/2026): e-mail sempre em minúsculas
  // antes de comparar com o banco — login não deveria depender de acertar
  // maiúscula/minúscula igual ao cadastro (todo e-mail salvo a partir de
  // agora já é normalizado na escrita, ver colaboradores.routes.ts, mas o
  // login não custa nada ser tolerante a isso também).
  email: z.string().email().transform(normalizarEmail),
  // .max(72): limite prático do bcrypt (trunca silenciosamente acima disso)
  // — não é sobre permitir senha grande, é sobre não mandar uma string
  // gigante pro bcrypt.compare à toa (achado de auditoria, 06/07/2026).
  senha: z.string().min(1).max(72),
});

// Persistência de login (08/07/2026): o refresh token não trafega mais no
// corpo JSON — vive só num cookie httpOnly, para que um XSS não consiga
// lê-lo via JavaScript (o access token, de vida curta, continua em memória
// no front). `sameSite: "none"` + `secure: true` em produção porque
// frontend (Vercel) e backend (Railway) são domínios diferentes — cookie
// cross-site exige essa combinação, e sem `secure: true` o navegador
// simplesmente recusa o cookie quando `sameSite` é "none". Em desenvolvimento
// (mesmo domínio "localhost", portas diferentes) "lax" basta e evita depender
// de HTTPS local.
//
// `path: "/"` (não só "/auth"): achado testando o item 3 da mesma missão
// (Menu Centralizado do Usuário, ver perfil.routes.ts) — GET /perfil/sessoes
// precisa ler este mesmo cookie pra marcar qual sessão é "esta sessão", e
// com `path: "/auth"` o navegador simplesmente não anexa o cookie em
// requisições para /perfil/*. Custo de abrir pra "/": o cookie (opaco,
// httpOnly, inútil sem o hash correspondente no banco) passa a viajar em
// toda chamada à API, não só nas de /auth — mesmo trade-off que a maioria
// dos frameworks de sessão já assume por padrão.
const REFRESH_COOKIE_NAME = "rt";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: (env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60,
  };
}

function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
}

const trocarSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1).max(72),
    novaSenha: z.string().min(8, "A nova senha precisa ter pelo menos 8 caracteres.").max(72),
  })
  // Achado de auditoria (06/07/2026): sem esta checagem, alguém com uma
  // senha temporária/compartilhada podia "satisfazer" a troca obrigatória
  // reenviando a mesma senha — precisaTrocarSenha virava false sem a senha
  // ter mudado de fato, justamente o controle que esse campo existe pra
  // garantir.
  .refine((d) => d.senhaAtual !== d.novaSenha, {
    message: "A nova senha precisa ser diferente da senha atual.",
    path: ["novaSenha"],
  });

function refreshExpiryDate(): Date {
  const dias = env.JWT_REFRESH_EXPIRES_IN_DAYS;
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

// "Esqueci minha senha" self-service (07/07/2026, pedido do Vini). Ver
// PasswordResetToken em schema.prisma para o raciocínio de segurança do
// token (opaco, hash no banco, uso único, expiração curta).
const esqueciSenhaSchema = z.object({ email: z.string().email().transform(normalizarEmail) });

const redefinirSenhaSchema = z.object({
  token: z.string().min(1),
  novaSenha: z.string().min(8, "A nova senha precisa ter pelo menos 8 caracteres.").max(72),
});

const EXPIRACAO_TOKEN_RESET_MS = 60 * 60 * 1000; // 1 hora
// Não é proteção de segurança (isso quem faz é o rate limit da rota) — é só
// pra não reenviar um segundo e-mail se a pessoa clicar duas vezes seguidas
// ou recarregar a página logo depois de pedir.
const COOLDOWN_REENVIO_MS = 60 * 1000;

export default async function authRoutes(app: FastifyInstance) {
  // POST /auth/login — limite mais apertado que o resto da API para
  // dificultar força bruta de senha (10 tentativas / minuto por IP).
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }
      const { email, senha } = parsed.data;

      const usuario = await app.prisma.usuario.findUnique({ where: { email } });

      // Mesma mensagem genérica tanto para e-mail inexistente quanto senha
      // errada — evita que o endpoint sirva de oráculo para enumerar e-mails
      // cadastrados no sistema.
      if (!usuario || !usuario.ativo) {
        return reply.code(401).send({ error: "E-mail ou senha inválidos." });
      }

      const senhaOk = await bcrypt.compare(senha, usuario.senhaHash);
      if (!senhaOk) {
        await registrarAuditoria(app, {
          usuarioId: usuario.id,
          acao: "LOGIN_FALHOU",
          entidade: "Usuario",
          entidadeId: usuario.id,
          ip: request.ip,
        });
        return reply.code(401).send({ error: "E-mail ou senha inválidos." });
      }

      const accessToken = app.jwt.sign({
        sub: usuario.id,
        papel: usuario.papel,
        colaboradorId: usuario.colaboradorId,
        precisaTrocarSenha: usuario.precisaTrocarSenha,
      });

      const refreshTokenPlain = generateRefreshToken();
      await app.prisma.refreshToken.create({
        data: {
          usuarioId: usuario.id,
          tokenHash: hashToken(refreshTokenPlain),
          expiraEm: refreshExpiryDate(),
        },
      });

      await registrarAuditoria(app, {
        usuarioId: usuario.id,
        acao: "LOGIN",
        entidade: "Usuario",
        entidadeId: usuario.id,
        ip: request.ip,
      });

      setRefreshCookie(reply, refreshTokenPlain);
      return reply.send({
        accessToken,
        usuario: {
          id: usuario.id,
          email: usuario.email,
          papel: usuario.papel,
          precisaTrocarSenha: usuario.precisaTrocarSenha,
        },
      });
    }
  );

  // POST /auth/refresh — rotaciona o refresh token a cada uso (revoga o
  // anterior e emite um novo), reduzindo a janela de replay se um token
  // vazar. O token em si agora vem do cookie httpOnly (ver
  // REFRESH_COOKIE_NAME acima) em vez do corpo da requisição — chamado tanto
  // manualmente pelo apiClient (quando um 401 acontece) quanto no boot do
  // app, para restaurar a sessão depois de um F5 sem exigir login de novo.
  app.post("/auth/refresh", async (request, reply) => {
    const refreshTokenPlain = request.cookies[REFRESH_COOKIE_NAME];
    if (!refreshTokenPlain) {
      return reply.code(401).send({ error: "Sessão não encontrada." });
    }
    const tokenHash = hashToken(refreshTokenPlain);

    const registro = await app.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!registro) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "Refresh token inválido ou expirado." });
    }

    // Ciclo de Evolução Contínua Nº 2 (10/07/2026) — detecção de reuso.
    // `registro.revogadoEm` só fica preenchido de duas formas: esta mesma
    // rota rotacionando o token (linha mais abaixo) ou POST /auth/logout.
    // Em ambos os casos, ninguém deveria estar reapresentando ESTE token de
    // novo — se está acontecendo, é o sinal clássico de um cookie roubado
    // sendo reproduzido por um atacante depois que a vítima (ou o próprio
    // navegador dela) já seguiu em frente com o token rotacionado. Resposta
    // correta não é só recusar este token isolado: é revogar a família
    // inteira (todo login desde a autenticação original), forçando um novo
    // login em todos os aparelhos daquela sessão — o mesmo padrão descrito
    // na documentação de rotação de refresh token da Auth0/OWASP. O erro
    // devolvido ao cliente continua sendo o mesmo 401 genérico de sempre —
    // só o tratamento interno muda — para não dar pista nenhuma a quem
    // estiver de fato tentando reusar um token roubado.
    if (registro.revogadoEm) {
      await app.prisma.refreshToken.updateMany({
        where: { familyId: registro.familyId, revogadoEm: null },
        data: { revogadoEm: new Date() },
      });
      await registrarAuditoria(app, {
        usuarioId: registro.usuarioId,
        acao: "REFRESH_TOKEN_REUSO_DETECTADO",
        entidade: "RefreshToken",
        entidadeId: registro.id,
        detalhe: { familyId: registro.familyId },
        ip: request.ip,
      });
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "Refresh token inválido ou expirado." });
    }

    if (registro.expiraEm < new Date()) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "Refresh token inválido ou expirado." });
    }

    const usuario = await app.prisma.usuario.findUnique({ where: { id: registro.usuarioId } });
    if (!usuario || !usuario.ativo) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: "Usuário inválido." });
    }

    await app.prisma.refreshToken.update({
      where: { id: registro.id },
      data: { revogadoEm: new Date() },
    });

    const novoRefreshPlain = generateRefreshToken();
    await app.prisma.refreshToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashToken(novoRefreshPlain),
        expiraEm: refreshExpiryDate(),
        // Copia a família do token sendo rotacionado — nunca gera uma nova
        // aqui (só o login inicial gera família nova, via @default no
        // schema). É isso que mantém toda a cadeia de rotação rastreável
        // como "a mesma sessão original", permitindo revogar tudo de uma
        // vez se um reuso for detectado mais adiante nessa cadeia.
        familyId: registro.familyId,
      },
    });

    const accessToken = app.jwt.sign({
      sub: usuario.id,
      papel: usuario.papel,
      colaboradorId: usuario.colaboradorId,
      precisaTrocarSenha: usuario.precisaTrocarSenha,
    });

    setRefreshCookie(reply, novoRefreshPlain);
    return reply.send({ accessToken });
  });

  // POST /auth/logout — revoga o refresh token atual (invalida a sessão
  // naquele dispositivo; o access token em uso expira sozinho em minutos) e
  // limpa o cookie no navegador, encerrando a sessão de fato (não só do lado
  // do servidor) — sem isso, o cookie ficaria retido no browser até expirar
  // sozinho, mesmo já revogado no banco.
  app.post("/auth/logout", async (request, reply) => {
    const refreshTokenPlain = request.cookies[REFRESH_COOKIE_NAME];
    if (refreshTokenPlain) {
      const tokenHash = hashToken(refreshTokenPlain);
      await app.prisma.refreshToken.updateMany({
        where: { tokenHash, revogadoEm: null },
        data: { revogadoEm: new Date() },
      });
    }
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  // GET /auth/me
  app.get("/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { id: request.user.sub },
      select: {
        id: true,
        email: true,
        papel: true,
        colaboradorId: true,
        ativo: true,
        precisaTrocarSenha: true,
      },
    });
    if (!usuario) return reply.code(404).send({ error: "Usuário não encontrado." });
    return reply.send(usuario);
  });

  // PATCH /auth/senha — única rota de escrita liberada enquanto
  // precisaTrocarSenha=true (ver src/plugins/auth.ts). Usada tanto para o
  // fluxo obrigatório de primeiro acesso quanto para troca voluntária depois.
  app.patch("/auth/senha", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = trocarSenhaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
    }
    const { senhaAtual, novaSenha } = parsed.data;

    const usuario = await app.prisma.usuario.findUnique({ where: { id: request.user.sub } });
    if (!usuario) return reply.code(404).send({ error: "Usuário não encontrado." });

    const senhaOk = await bcrypt.compare(senhaAtual, usuario.senhaHash);
    if (!senhaOk) {
      return reply.code(401).send({ error: "Senha atual incorreta." });
    }

    const novaSenhaHash = await bcrypt.hash(novaSenha, 12);
    await app.prisma.usuario.update({
      where: { id: usuario.id },
      data: { senhaHash: novaSenhaHash, precisaTrocarSenha: false },
    });

    // Achado de auditoria (06/07/2026): revoga todo refresh token deste
    // usuário — sem isso, uma senha temporária/compartilhada que vazou (ou
    // foi usada por mais de uma pessoa antes da troca) continuava dando
    // sessão indefinidamente em qualquer dispositivo, mesmo depois da troca.
    // Não afeta o dispositivo atual: o access token novo é emitido abaixo,
    // então esta sessão segue sem exigir login de novo; só os refresh
    // tokens (usados pra renovar depois que o access token expira) são
    // invalidados — o mesmo padrão que /auth/logout já usa, aplicado a
    // todos os tokens do usuário em vez de só um.
    await app.prisma.refreshToken.updateMany({
      where: { usuarioId: usuario.id, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });

    await registrarAuditoria(app, {
      usuarioId: usuario.id,
      acao: "TROCA_SENHA",
      entidade: "Usuario",
      entidadeId: usuario.id,
      ip: request.ip,
    });

    // Emite um novo access token já sem a flag pendente — evita exigir um
    // novo login logo em seguida só para "destravar" a sessão atual.
    const accessToken = app.jwt.sign({
      sub: usuario.id,
      papel: usuario.papel,
      colaboradorId: usuario.colaboradorId,
      precisaTrocarSenha: false,
    });

    return reply.send({
      accessToken,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        papel: usuario.papel,
        precisaTrocarSenha: false,
      },
    });
  });

  // POST /auth/esqueci-senha — sem autenticação, por definição (quem chama
  // não consegue logar). Rate limit mais apertado que o padrão (mesmo
  // raciocínio do /auth/login) porque, embora não sirva pra descobrir senha,
  // dá pra floodar a caixa de entrada de alguém se não tivesse limite.
  app.post(
    "/auth/esqueci-senha",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = esqueciSenhaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Informe um e-mail válido." });
      }

      // Resposta sempre igual, exista ou não o e-mail cadastrado, tenha
      // dado certo o envio ou não — mesmo raciocínio do /auth/login: esse
      // endpoint não pode virar um jeito de descobrir quais e-mails têm
      // conta no sistema.
      const respostaGenerica = {
        message: "Se este e-mail estiver cadastrado, enviamos um link de redefinição de senha.",
      };

      const usuario = await app.prisma.usuario.findUnique({ where: { email: parsed.data.email } });
      if (!usuario || !usuario.ativo) {
        return reply.send(respostaGenerica);
      }

      const tokenRecente = await app.prisma.passwordResetToken.findFirst({
        where: { usuarioId: usuario.id, criadoEm: { gt: new Date(Date.now() - COOLDOWN_REENVIO_MS) } },
      });
      if (tokenRecente) {
        return reply.send(respostaGenerica);
      }

      const tokenPlain = generateRefreshToken();
      await app.prisma.passwordResetToken.create({
        data: {
          usuarioId: usuario.id,
          tokenHash: hashToken(tokenPlain),
          expiraEm: new Date(Date.now() + EXPIRACAO_TOKEN_RESET_MS),
        },
      });

      const link = `${env.FRONTEND_URL}/redefinir-senha?token=${tokenPlain}`;
      try {
        await enviarEmail({
          to: usuario.email,
          subject: "Redefinição de senha — Administrar Imóveis",
          html: templateRedefinicaoSenha(link),
        });
      } catch {
        // Não propaga pro cliente — a resposta continua a genérica de
        // sempre, pra não vazar se o e-mail existe ou se foi problema de
        // envio. O erro de verdade já foi logado dentro de enviarEmail.
      }

      await registrarAuditoria(app, {
        usuarioId: usuario.id,
        acao: "SOLICITAR_REDEFINICAO_SENHA",
        entidade: "Usuario",
        entidadeId: usuario.id,
        ip: request.ip,
      });

      return reply.send(respostaGenerica);
    }
  );

  // POST /auth/redefinir-senha — segunda metade do fluxo acima: recebe o
  // token que veio por e-mail e a nova senha escolhida pelo colaborador.
  app.post(
    "/auth/redefinir-senha",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = redefinirSenhaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Dados inválidos.", detalhes: parsed.error.flatten() });
      }

      const tokenHash = hashToken(parsed.data.token);
      const registro = await app.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

      // Mesma mensagem tanto para token inexistente, já usado ou expirado —
      // não há razão pra diferenciar esses casos pra quem está do outro
      // lado, e diferenciar só ajudaria alguém tentando adivinhar um token.
      const erroTokenInvalido = { error: "Link inválido ou expirado. Solicite um novo." };
      if (!registro || registro.usadoEm || registro.expiraEm < new Date()) {
        return reply.code(400).send(erroTokenInvalido);
      }

      const usuario = await app.prisma.usuario.findUnique({ where: { id: registro.usuarioId } });
      // Não reativa uma conta desligada/desativada — isso continua sendo
      // decisão exclusiva de quem administra (ver /colaboradores/:id/
      // resetar-senha), não algo que o próprio "esqueci minha senha"
      // self-service deveria conseguir contornar.
      if (!usuario || !usuario.ativo) {
        return reply.code(400).send(erroTokenInvalido);
      }

      const novaSenhaHash = await bcrypt.hash(parsed.data.novaSenha, 12);
      await app.prisma.$transaction([
        app.prisma.usuario.update({
          where: { id: usuario.id },
          data: { senhaHash: novaSenhaHash, precisaTrocarSenha: false },
        }),
        app.prisma.passwordResetToken.update({
          where: { id: registro.id },
          data: { usadoEm: new Date() },
        }),
        // Mesmo motivo do /auth/senha: uma sessão aberta em outro
        // dispositivo (ou por quem quer que tenha usado a senha esquecida
        // até aqui) para de valer assim que a senha muda de verdade.
        app.prisma.refreshToken.updateMany({
          where: { usuarioId: usuario.id, revogadoEm: null },
          data: { revogadoEm: new Date() },
        }),
      ]);

      await registrarAuditoria(app, {
        usuarioId: usuario.id,
        acao: "REDEFINIR_SENHA",
        entidade: "Usuario",
        entidadeId: usuario.id,
        ip: request.ip,
      });

      return reply.send({ message: "Senha redefinida com sucesso. Faça login com a nova senha." });
    }
  );
}
