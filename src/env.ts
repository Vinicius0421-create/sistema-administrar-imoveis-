import "dotenv/config";
import { z } from "zod";

// Falha rápido e com mensagem clara se alguma variável obrigatória faltar,
// em vez de deixar o erro estourar depois, no meio de uma requisição.
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET deve ter pelo menos 16 caracteres"),
  // JWT_REFRESH_SECRET removido (10/07/2026, Ciclo de Evolução Contínua):
  // resquício de um design anterior. Refresh tokens nunca foram JWTs
  // assinados — são valores opacos aleatórios (randomBytes(48)), com hash
  // SHA-256 guardado em RefreshToken.tokenHash (ver utils/tokens.ts e
  // auth.routes.ts) — só o access token é um JWT de verdade, assinado com
  // JWT_ACCESS_SECRET acima. Manter uma variável obrigatória que não fazia
  // nada arriscava passar a falsa impressão de que refresh tokens também
  // eram verificados por assinatura. Seguro remover: continuar com a
  // variável configurada no Railway não quebra nada (só deixa de ser lida),
  // e removê-la de lá é opcional.
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().default(7),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  // Opcional de propósito — sem essa variável, src/instrument.ts não inicia
  // o Sentry e nada muda no comportamento do servidor. Ver documentação no
  // projeto Claude ("Sistema_Interno_Deploy_Producao.md") sobre como obter
  // um DSN gratuito.
  SENTRY_DSN: z.string().optional(),
  // Onde os anexos de chamado de manutenção são gravados em disco. Em
  // produção aponta para o mount path de um Railway Volume (ver
  // `railway volume list`) — decisão tomada em 06/07/2026, documentada em
  // schema.prisma junto do enum TipoEventoChamado. O default local
  // ("./uploads/anexos-chamados") é só pra dev, sem depender de volume nenhum.
  ANEXOS_DIR: z.string().default("./uploads/anexos-chamados"),
  // "Esqueci minha senha" self-service (07/07/2026, pedido do Vini). Opcional
  // de propósito, mesmo padrão do SENTRY_DSN acima: sem RESEND_API_KEY, a
  // rota /auth/esqueci-senha continua respondendo normalmente (nunca vaza se
  // o e-mail existe ou não), só não envia nada de verdade — loga um aviso
  // (ver utils/email.ts) em vez de quebrar o resto do sistema. Conta no
  // Resend (resend.com) é gratuita até 100 e-mails/dia — mais que suficiente
  // pros colaboradores cadastrados hoje.
  RESEND_API_KEY: z.string().optional(),
  // Remetente que aparece pro colaborador. "onboarding@resend.dev" funciona
  // sem verificar domínio próprio (bom pra começar); trocar depois por algo
  // como "Administrar Imóveis <naoresponda@administrarimoveis.com.br>" exige
  // verificar o domínio administrarimoveis.com.br no painel do Resend.
  RESEND_FROM_EMAIL: z.string().default("Administrar Imóveis <onboarding@resend.dev>"),
  // Base da URL do frontend, usada só para montar o link que vai no e-mail
  // de redefinição de senha (ex: `${FRONTEND_URL}/redefinir-senha?token=...`).
  FRONTEND_URL: z.string().url().default("https://administrar-imoveis.vercel.app"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variáveis de ambiente inválidas:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
