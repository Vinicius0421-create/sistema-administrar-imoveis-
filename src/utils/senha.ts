import { randomInt } from "node:crypto";

// Sem 0/O, 1/l/I — caracteres que se confundem fácil quando alguém dita a
// senha temporária por telefone/WhatsApp ou digita de uma folha impressa.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Gera uma senha temporária legível para entregar a um colaborador depois de
 * um reset — sempre usada em conjunto com `precisaTrocarSenha: true`, então
 * não precisa durar: só precisa ser fácil de repassar e impossível de
 * adivinhar até a pessoa trocar por uma senha só dela.
 */
export function gerarSenhaTemporaria(tamanho = 10): string {
  let senha = "";
  for (let i = 0; i < tamanho; i++) {
    senha += ALFABETO[randomInt(ALFABETO.length)];
  }
  return senha;
}
