import { env } from "../env";

// E-mail transacional via Resend (resend.com) — usado só pro fluxo de
// "esqueci minha senha" (07/07/2026, pedido do Vini: evitar que todo
// esquecimento de senha vire mensagem pro administrador). Chamado direto via
// fetch (disponível nativamente a partir do Node 18) em vez de instalar o
// SDK oficial — é uma chamada HTTP simples, não compensa mais uma
// dependência só pra isso.
//
// RESEND_API_KEY é opcional (ver env.ts): sem ela, a função só loga um aviso
// e retorna sem lançar erro — mesmo padrão do SENTRY_DSN opcional. Isso
// importa especialmente aqui porque o chamador (POST /auth/esqueci-senha)
// precisa continuar respondendo a mensagem genérica de sempre mesmo sem
// conseguir enviar nada, pra não vazar se o e-mail existe no sistema.
export async function enviarEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY não configurada — e-mail para ${to} NÃO foi enviado (assunto: "${subject}").`);
    return;
  }

  const resposta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    console.error(`[email] Falha ao enviar e-mail via Resend (status ${resposta.status}): ${corpo}`);
    throw new Error("Não foi possível enviar o e-mail.");
  }
}

// HTML simples e auto-contido (sem imagens externas, sem CSS externo) —
// entrega mais confiável em clientes de e-mail corporativo/celular do que um
// template elaborado, e não depende do logo carregar de lugar nenhum.
export function templateRedefinicaoSenha(link: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a;">Administrar Imóveis</h2>
      <p>Recebemos um pedido para redefinir a senha da sua conta no sistema interno.</p>
      <p>
        <a href="${link}" style="display: inline-block; background: #dc2626; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: 600;">
          Redefinir minha senha
        </a>
      </p>
      <p style="font-size: 13px; color: #64748b;">Este link expira em 1 hora e só pode ser usado uma vez.</p>
      <p style="font-size: 13px; color: #64748b;">Se você não pediu essa redefinição, pode ignorar este e-mail — sua senha continua a mesma.</p>
    </div>
  `.trim();
}
