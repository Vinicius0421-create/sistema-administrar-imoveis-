import { apiRequest } from "../lib/apiClient";
import { Usuario } from "../types";

export interface LoginResponse {
  accessToken: string;
  // Persistência de Login (08/07/2026): o refresh token não vem mais no
  // corpo — o backend já grava um cookie httpOnly na mesma resposta (ver
  // setRefreshCookie em auth.routes.ts), então este código nunca precisa
  // enxergá-lo.
  usuario: { id: string; email: string; papel: Usuario["papel"]; precisaTrocarSenha?: boolean };
}

export interface TrocarSenhaResponse {
  accessToken: string;
  usuario: { id: string; email: string; papel: Usuario["papel"]; precisaTrocarSenha: boolean };
}

export const authApi = {
  login: (email: string, senha: string) =>
    apiRequest<LoginResponse>("/auth/login", { method: "POST", body: { email, senha } }),

  // Sem parâmetro: o refresh token a revogar vem do cookie httpOnly,
  // enviado automaticamente (apiRequest já manda `credentials: "include"`).
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),

  me: () => apiRequest<Usuario>("/auth/me"),

  trocarSenha: (senhaAtual: string, novaSenha: string) =>
    apiRequest<TrocarSenhaResponse>("/auth/senha", { method: "PATCH", body: { senhaAtual, novaSenha } }),

  // "Esqueci minha senha" self-service (07/07/2026, pedido do Vini). Não
  // exige estar logado — ver rotas públicas equivalentes em auth.routes.ts
  // no backend, com a mesma resposta genérica de sempre (não vaza se o
  // e-mail existe no sistema).
  esqueciSenha: (email: string) =>
    apiRequest<{ message: string }>("/auth/esqueci-senha", { method: "POST", body: { email } }),

  redefinirSenha: (token: string, novaSenha: string) =>
    apiRequest<{ message: string }>("/auth/redefinir-senha", { method: "POST", body: { token, novaSenha } }),
};
