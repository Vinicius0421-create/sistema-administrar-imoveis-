/**
 * Padronização Global de Máscaras, Formatos e Validações (Fase 3, 09/07/2026,
 * pedido do Vini) — funções de normalização/validação reaproveitadas em
 * todas as rotas que recebem os campos abaixo, pra garantir que o mesmo dado
 * nunca seja salvo em formatos diferentes dependendo de como foi digitado.
 *
 * Convenção adotada (documentada aqui pra não precisar repetir em cada
 * rota): CPF, CNPJ e telefone são armazenados SEMPRE como dígitos puros (sem
 * pontuação), nunca com a máscara aplicada. Isso já era o padrão de fato dos
 * dados existentes no sistema (ver `normalizarTelefone` em utils/telefone.ts,
 * criado na Etapa 1 de Linhas Telefônicas) e evita um problema real: se o
 * valor fosse salvo formatado, "123.456.789-10" e "12345678910" digitados
 * pela mesma pessoa em momentos diferentes virariam registros "diferentes"
 * pra uma checagem de duplicidade (`findUnique` por igualdade exata), além
 * de duas pessoas conseguirem cadastrar o "mesmo" CPF só porque um digitou
 * com pontuação e o outro sem. A máscara em si (999.999.999-99 etc.) é
 * responsabilidade só da camada de apresentação — aplicada em tempo real
 * na digitação e na exibição no frontend (ver src/lib/mascaras.ts lá),
 * nunca persistida.
 */

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Mesmo algoritmo de dígito verificador do CPF (utils/cpf.ts), adaptado pro
// CNPJ — pesos diferentes, mas o mesmo princípio de módulo 11.
export function isValidCnpj(raw: string): boolean {
  const cnpj = somenteDigitos(raw);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcDigit = (base: string, pesos: number[]): number => {
    const total = base.split("").reduce((acc, digito, i) => acc + Number(digito) * (pesos[i] ?? 0), 0);
    const resto = total % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const digito1 = calcDigit(cnpj.slice(0, 12), pesos1);
  const digito2 = calcDigit(cnpj.slice(0, 12) + digito1, pesos2);

  return cnpj.endsWith(`${digito1}${digito2}`);
}

// Telefone brasileiro válido: DDD (2 dígitos) + número (8 dígitos fixo ou 9
// dígitos celular, sempre começando em 9) = 10 ou 11 dígitos no total.
export function isValidTelefone(digits: string): boolean {
  return digits.length === 10 || digits.length === 11;
}

// Conectores que ficam em minúscula dentro do nome (exceto se forem a
// primeira palavra) — lista cobre os casos comuns em nomes brasileiros;
// qualquer palavra fora dela é capitalizada normalmente.
const CONECTORES_NOME = new Set(["de", "da", "do", "das", "dos", "e"]);

// Capitaliza um nome próprio brasileiro: primeira letra maiúscula de cada
// palavra, conectores (de/da/do/das/dos/e) em minúscula quando não são a
// primeira palavra. Corrige tanto "JOÃO DA SILVA" quanto "joão da silva"
// pro mesmo "João da Silva" — sem isso, o mesmo nome aparecia formatado de
// jeitos diferentes dependendo de como cada pessoa/planilha digitou.
export function capitalizarNome(nome: string): string {
  return nome
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((palavra, i) => {
      if (!palavra) return palavra;
      const minuscula = palavra.toLocaleLowerCase("pt-BR");
      if (i > 0 && CONECTORES_NOME.has(minuscula)) return minuscula;
      return minuscula.charAt(0).toLocaleUpperCase("pt-BR") + minuscula.slice(1);
    })
    .join(" ");
}
