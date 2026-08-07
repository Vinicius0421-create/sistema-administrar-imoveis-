// Mapa código (COMPE) → nome do banco (21/07/2026, pedido do Vini: "ao
// selecionar o código do banco, o sistema deve preencher automaticamente o
// nome do banco, evitando digitação manual"). Cobre os bancos mais comuns
// no dia a dia de folha de pagamento no Brasil — não é a lista completa da
// Febraban (isso mudaria pouco o resultado prático e exigiria manutenção
// constante); banco fora desta lista continua aceito normalmente, só sem o
// autofill (o campo "Nome do banco" permanece editável à mão em qualquer
// caso, então nunca bloqueia o cadastro).
export const NOME_BANCO_POR_CODIGO: Record<string, string> = {
  "001": "Banco do Brasil",
  "003": "Banco da Amazônia",
  "004": "Banco do Nordeste",
  "021": "Banestes",
  "025": "Banco Alfa",
  "033": "Santander",
  "036": "Banco Bradesco BBI",
  "037": "Banco do Estado do Pará",
  "041": "Banrisul",
  "047": "Banco do Estado de Sergipe",
  "070": "BRB — Banco de Brasília",
  "077": "Banco Inter",
  "084": "Uniprime",
  "085": "Cooperativa Central Ailos",
  "099": "Uniprime Central",
  "104": "Caixa Econômica Federal",
  "121": "Banco Agibank",
  "136": "Unicred",
  "197": "Stone",
  "208": "Banco BTG Pactual",
  "212": "Banco Original",
  "218": "Banco BS2",
  "224": "Banco Fibra",
  "237": "Bradesco",
  "246": "Banco ABC Brasil",
  "260": "Nu Pagamentos (Nubank)",
  "265": "Banco Fator",
  "290": "PagBank (PagSeguro)",
  "318": "Banco BMG",
  "323": "Mercado Pago",
  "336": "Banco C6",
  "341": "Itaú Unibanco",
  "348": "Banco XP",
  "356": "Banco Real",
  "366": "Banco Société Générale Brasil",
  "380": "PicPay",
  "389": "Banco Mercantil do Brasil",
  "399": "HSBC Bank Brasil",
  "403": "Cora",
  "422": "Banco Safra",
  "455": "Fatto Financeira",
  "456": "Banco MUFG Brasil",
  "461": "Asaas",
  "473": "Banco Caixa Geral Brasil",
  "477": "Citibank",
  "479": "Banco ItaúBank",
  "487": "Deutsche Bank Brasil",
  "488": "JPMorgan Chase Bank",
  "492": "ING Bank",
  "505": "Banco Credit Suisse Brasil",
  "623": "Banco Pan",
  "633": "Banco Rendimento",
  "637": "Banco Sofisa",
  "643": "Banco Pine",
  "652": "Itaú Unibanco Holding (Itaú BBA)",
  "655": "Banco Votorantim (Banco BV)",
  "707": "Banco Daycoval",
  "735": "Banco Neon",
  "739": "Banco Cetelem",
  "741": "Banco Ribeirão Preto",
  "745": "Banco Citibank",
  "746": "Banco Modal",
  "748": "Sicredi",
  "751": "Scotiabank Brasil",
  "755": "Bank of America Merrill Lynch",
  "756": "Sicoob",
  "796": "Banco Real Investimentos (Banco Losango)",
  "805": "Credisan",
};

// Progressiva/mesmo espírito das funções de src/lib/mascaras.ts: recebe o
// valor atual do campo (código do banco, 3 dígitos) e devolve o nome
// conhecido, ou undefined se o código não estiver no mapa (nesse caso o
// chamador simplesmente não sobrescreve o campo "Nome do banco").
export function nomeBancoPorCodigo(codigo: string): string | undefined {
  return NOME_BANCO_POR_CODIGO[codigo.trim()];
}
