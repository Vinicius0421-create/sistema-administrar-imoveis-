/**
 * Normalização de telefone — usada pra comparar números digitados em
 * formatos diferentes ((37) 99999-9999, 37999999999, 37 9999-9999 etc.)
 * como o mesmo número de verdade.
 *
 * Criado na Etapa 1 (08/07/2026, pedido do Vini — Reestruturação e
 * Sincronização das Linhas Telefônicas): usado tanto pra decidir se o
 * "telefone de contato" de um colaborador bate com o número da linha
 * corporativa vinculada, quanto pra sugerir automaticamente qual
 * colaborador cadastrado combina com uma linha ainda pendente de
 * reconciliação (`colaboradorInformado` sem `colaboradorId`).
 */
export function normalizarTelefone(numero: string | null | undefined): string | null {
  if (!numero) return null;
  let digitos = numero.replace(/\D/g, "");
  if (!digitos) return null;
  // Remove código do país (55) quando sobra dígito demais pra ser só
  // DDD + número — evita falso-negativo em número salvo com "+55" na frente.
  if (digitos.startsWith("55") && digitos.length > 11) {
    digitos = digitos.slice(2);
  }
  return digitos;
}

/**
 * Compara dois números já sabendo que celulares antigos (8 dígitos, sem o
 * "9" na frente) e o mesmo número digitado certo (9 dígitos) são, na
 * prática, o mesmo número — erro de digitação comum, não um número
 * diferente. Usado só pra classificar divergências no relatório de
 * auditoria (Etapa 1), nunca pra decidir automaticamente qual valor está
 * certo.
 */
export function mesmoNumeroComOuSemNono(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const semNono = (d: string) => (d.length === 11 ? d.slice(0, 2) + d.slice(3) : d);
  return semNono(a) === semNono(b);
}
