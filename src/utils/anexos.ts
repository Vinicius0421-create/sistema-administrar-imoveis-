import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../env";

// Armazenamento de anexos de chamado de manutenção — decisão de 06/07/2026
// (Railway Volume, ver comentário em schema.prisma junto do enum
// TipoEventoChamado). Tudo fica dentro de ANEXOS_DIR, organizado em uma
// subpasta por chamado, pra facilitar limpeza/inspeção manual se precisar.

// Só isso passa pelo filtro — cobre foto de problema (JPEG/PNG/WEBP/GIF) e
// nota fiscal/comprovante escaneado (PDF). Deliberadamente sem vídeo/áudio:
// arquivo grande demais pro tamanho do volume (500MB) e sem caso de uso
// relatado até agora.
export const MIME_TYPES_PERMITIDOS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB por arquivo

// Anexo de mensagem do chat interno (08/07/2026, pedido do Vini: "coloque
// uma forma de anexar imagens e vídeos também nas mensagens"). Lista e
// limite separados dos de cima de propósito — cobrir vídeo aqui não afeta
// anexo de chamado, que continua deliberadamente sem vídeo (ver comentário
// acima). Limite maior (20MB) porque vídeo curto de celular passa fácil de
// 10MB; ainda assim moderado pra não estourar o volume do Railway (500MB)
// rápido demais com pouca gente usando — reavaliar se o uso crescer.
export const MIME_TYPES_PERMITIDOS_MENSAGEM = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov, comum em vídeo gravado de iPhone
]);

export const TAMANHO_MAXIMO_BYTES_MENSAGEM = 20 * 1024 * 1024; // 20MB por anexo de mensagem

export function garantirDiretorioAnexos(): void {
  fs.mkdirSync(env.ANEXOS_DIR, { recursive: true });
}

// Remove separadores de caminho e caracteres fora do básico — o nome final
// em disco sempre carrega um prefixo aleatório (ver caminhoParaNovoAnexo), o
// sanitize aqui é só pra impedir que o nome original vire um path traversal
// ou um caractere que quebre o Content-Disposition no download.
export function sanitizarNomeArquivo(nome: string): string {
  const base = path.basename(nome).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(-120) || "arquivo";
}

// `pastaId` é só uma chave de agrupamento (um chamado, um colaborador, etc.)
// — vira o nome da subpasta dentro de ANEXOS_DIR. Reaproveitado a partir de
// 07/07/2026 para o anexo do termo de responsabilidade em Colaborador (antes
// só existia para anexo de ChamadoEvento); o parâmetro já era genérico o
// bastante, só o nome (antes `chamadoId`) que foi atualizado pra refletir isso.
export function caminhoParaNovoAnexo(pastaId: string, nomeOriginal: string): { caminhoRelativo: string; caminhoAbsoluto: string } {
  const nomeArquivo = `${randomUUID()}-${sanitizarNomeArquivo(nomeOriginal)}`;
  const caminhoRelativo = path.join(pastaId, nomeArquivo);
  const caminhoAbsoluto = path.join(env.ANEXOS_DIR, caminhoRelativo);
  return { caminhoRelativo, caminhoAbsoluto };
}

// Resolve o caminho relativo salvo em ChamadoEvento.anexoUrl de volta pro
// caminho absoluto em disco, com checagem defensiva de que o resultado não
// escapou de ANEXOS_DIR (anexoUrl é sempre gerado pelo próprio servidor, via
// caminhoParaNovoAnexo — isso aqui é rede de segurança, não expectativa real).
export function caminhoAbsolutoDoAnexo(caminhoRelativo: string): string | null {
  const base = path.resolve(env.ANEXOS_DIR);
  const resolvido = path.resolve(base, caminhoRelativo);
  if (!resolvido.startsWith(base + path.sep) && resolvido !== base) return null;
  return resolvido;
}

export function removerArquivoAnexo(caminhoRelativo: string | null | undefined): void {
  if (!caminhoRelativo) return;
  const absoluto = caminhoAbsolutoDoAnexo(caminhoRelativo);
  if (!absoluto) return;
  fs.rm(absoluto, { force: true }, () => {
    // Best-effort: se o arquivo já não existir ou o unlink falhar, não há
    // nada de útil a fazer aqui — o registro do evento já foi (ou vai ser)
    // removido do banco independentemente, que é o que importa pro usuário.
  });
}
