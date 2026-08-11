// Verificação de fumaça offline: bundla os módulos reais do app (não uma
// cópia) com esbuild, monta em jsdom com fetch mockado, e confirma que a
// tela de login e o shell autenticado renderizam sem lançar exceção.
// Mesma técnica usada para validar a prévia (Babel+jsdom), adaptada para
// TSX real + módulos ES.
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const entry = path.join(root, "scripts", "smoke-entry.tsx");

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  loader: { ".tsx": "tsx", ".ts": "ts" },
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://localhost:3333") },
});

const code = result.outputFiles[0].text;

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.localStorage = undefined; // garante que nada no app dependa disso

const chamadasFetch = [];
global.fetch = async (url, options) => {
  chamadasFetch.push(String(url));
  const body = options?.body ? JSON.parse(options.body) : null;
  if (String(url).includes("/auth/login")) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        accessToken: "fake.access.token",
        refreshToken: "fake-refresh-token",
        usuario: { id: "u1", email: body.email, papel: "ADMINISTRADOR" },
      }),
    };
  }
  if (String(url).includes("/auth/me")) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ id: "u1", email: "admin@administrarimoveis.com.br", papel: "ADMINISTRADOR", colaboradorId: null }),
    };
  }
  // Todas as listagens: devolve uma página vazia paginada / lista vazia.
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ items: [], meta: { total: 0, page: 1, pageSize: 100, totalPages: 1 } }),
  };
};

const errors = [];
const originalConsoleError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(" "));
  originalConsoleError(...args);
};

try {
  // eslint-disable-next-line no-eval
  (0, eval)(code);
} catch (err) {
  console.error("ERRO AO EXECUTAR O BUNDLE:", err);
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 300));

const rootHtmlLogin = document.getElementById("root").innerHTML;
console.log("=== Tela de Login ===");
console.log("Contém 'ADMINISTRAR':", rootHtmlLogin.includes("ADMINISTRAR"));
console.log("Contém campo de e-mail:", rootHtmlLogin.includes('type="email"'));
console.log("Tamanho renderizado:", rootHtmlLogin.length, "caracteres");

// Simula o preenchimento e o submit do formulário de login.
const emailInput = document.querySelector('input[type="email"]');
const senhaInput = document.querySelector('input[type="password"]');
const form = document.querySelector("form");

function setNativeValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

setNativeValue(emailInput, "admin@administrarimoveis.com.br");
setNativeValue(senhaInput, "senha-teste-123");
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

await new Promise((r) => setTimeout(r, 500));

const rootHtmlApp = document.getElementById("root").innerHTML;
console.log("\n=== Após login (shell autenticado) ===");
console.log("Contém 'Visão Geral' (Home):", rootHtmlApp.includes("Vis") && rootHtmlApp.includes("Geral"));
console.log("Contém nav 'Colaboradores':", rootHtmlApp.includes("Colaboradores"));
console.log("Contém badge de papel 'Administrador Geral':", rootHtmlApp.includes("Administrador Geral"));
console.log("Chamadas de fetch realizadas:", chamadasFetch.length);
console.log("Endpoints chamados:", [...new Set(chamadasFetch.map((u) => new URL(u).pathname))].sort().join(", "));
console.log("\nErros de console capturados:", errors.length);
errors.forEach((e) => console.log(" -", e.slice(0, 400)));

process.exit(errors.length > 0 ? 1 : 0);
