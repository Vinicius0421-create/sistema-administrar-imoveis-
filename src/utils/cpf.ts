/**
 * Máscara de CPF para respostas de API.
 *
 * O protótipo original (sistema-administrar-imoveis.jsx) trafegava o CPF
 * completo de todos os colaboradores em qualquer listagem — inclusive
 * embutido em texto plano no bundle JS. Aqui, por padrão, todo endpoint
 * de leitura devolve o CPF mascarado; o valor completo só é incluído
 * quando o chamador tem papel ADMINISTRADOR (ver requireRole) e a
 * consulta é registrada em AuditLog.
 */
export function maskCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null; // conta de função — sem CPF
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return "***.***.***-**";
  return `***.${digits.slice(3, 6)}.***-${digits.slice(9, 11)}`;
}

export function isValidCpf(rawCpf: string): boolean {
  const cpf = rawCpf.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (base: string, factor: number): number => {
    let total = 0;
    for (const char of base) {
      total += Number(char) * factor;
      factor--;
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const digit1 = calcDigit(cpf.slice(0, 9), 10);
  const digit2 = calcDigit(cpf.slice(0, 9) + digit1, 11);

  return cpf.endsWith(`${digit1}${digit2}`);
}
