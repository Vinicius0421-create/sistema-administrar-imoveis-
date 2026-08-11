/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // Tema escuro (10/07/2026, pedido do Vini: "tema do sistema e etc" — ver
  // Preferências no menu do usuário). `"class"` em vez de `"media"`: a
  // pessoa escolhe explicitamente Claro/Escuro/Sistema, e o app aplica a
  // classe `dark` em <html> conforme a escolha (ver theme/ThemeContext.tsx)
  // — com `"media"` não daria pra ter a opção "Claro" fixa mesmo com o SO
  // em modo escuro, por exemplo.
  darkMode: "class",
  theme: {
    extend: {
      // Fase 5 (Identidade Visual, Opção C — reformulação completa, 05/07/2026).
      // O sistema usava o vermelho padrão do Tailwind (red-600 = #DC2626), que
      // é visivelmente menos saturado/mais alaranjado que o vermelho real da
      // logo/Instagram da Administrar Imóveis (~#FD2F37, medido pixel a pixel
      // em `src/assets/logo.ts`). Esta rampa substitui todo uso de `red-*` no
      // app (classes já migradas via find/replace mecânico — mesmos números
      // de tom, mesmo comportamento de hover/foco/opacidade, só a cor muda).
      //
      // `600` não é a cor pura da logo: um branco em cima de `#FD2F37` sólido
      // cai pra 3.7:1 de contraste (abaixo do mínimo AA de 4.5:1 pra texto
      // normal) — o que seria uma regressão de acessibilidade em botões e
      // textos. `600` usa o mesmo matiz/saturação levemente mais escurecidos,
      // garantindo 4.55:1. A cor pura e vibrante da logo continua disponível
      // em `500`, pra usos decorativos (ícones, glow, destaques) onde
      // contraste de texto não é a limitação.
      colors: {
        brand: {
          50: "#FEF2F3",
          100: "#FDE6E7",
          200: "#FCD3D5",
          300: "#FAB2B5",
          400: "#F68084",
          500: "#FD2F37", // vermelho puro da logo (medido pixel a pixel)
          600: "#ED020B", // cor de ação principal — 4.55:1 com texto branco
          700: "#B70208", // hover / texto sobre fundo claro — 6.94:1
          800: "#A70108",
          900: "#A60108",
          950: "#420103",
        },
      },
    },
  },
  plugins: [],
};
