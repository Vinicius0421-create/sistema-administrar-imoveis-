import { randomBytes, createHash } from "node:crypto";

/**
 * Refresh tokens são opacos (não JWT): um segredo aleatório de alta entropia,
 * guardado no banco só como hash. Isso permite revogar tokens individualmente
 * (logout, comprometimento de dispositivo) sem precisar de blacklist de JWT.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
