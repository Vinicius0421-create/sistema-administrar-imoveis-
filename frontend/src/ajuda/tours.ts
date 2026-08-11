import { Papel } from "../types";

// Item 4 da missão "Melhorias Adicionais" (08/07/2026) — passos do tour
// guiado, separados dos artigos da Central de Ajuda (conteudo.ts) porque
// servem a um propósito diferente: apontar pra elementos reais da tela
// (via seletor CSS) em vez de só descrever em texto corrido. Cada passo
// aponta pra um elemento marcado com `data-tour="..."` em App.tsx ou
// PortalColaborador.tsx — ver TourGuiado.tsx para o motor que lê isso.
//
// Escopo deliberado: os passos do AppShell cobrem a "casca" comum a todos
// os papéis que usam barra lateral (logo, navegação, indicador de conexão,
// ajuda, menu do usuário, sair) — não um passo por módulo. Entrar em cada
// um dos até 12 módulos por tour guiado tornaria o tour longo demais pra
// ser útil no primeiro acesso; o conteúdo por módulo já existe em detalhe
// na Central de Ajuda (artigo "Módulos" correspondente), que o próprio
// último passo do tour indica.

export interface PassoTour {
  seletor: string;
  titulo: string;
  texto: string;
}

const CHAVE_APPSHELL = "appshell_v1";
const CHAVE_PORTAL = "portal_v1";

const PASSOS_APPSHELL: PassoTour[] = [
  {
    seletor: '[data-tour="logo"]',
    titulo: "Bem-vindo(a) ao Sistema Administrar Imóveis",
    texto: "Este tour rápido mostra onde encontrar cada parte do sistema. Você pode refazê-lo a qualquer momento pela Central de Ajuda.",
  },
  {
    seletor: '[data-tour="sidebar-nav"]',
    titulo: "Menu de navegação",
    texto: "Aqui ficam os módulos disponíveis para o seu papel de acesso — a lista muda conforme suas permissões, então nem todo mundo vê os mesmos itens.",
  },
  {
    seletor: '[data-tour="indicador-conexao"]',
    titulo: "Indicador de conexão",
    texto: "Mostra se você está online, sincronizando ou offline. Se algum chamado foi salvo neste aparelho por falta de conexão, ele aparece aqui até ser enviado.",
  },
  {
    seletor: '[data-tour="botao-ajuda"]',
    titulo: "Central de Ajuda",
    texto: "Clique aqui a qualquer momento para buscar tutoriais completos por assunto, com passo a passo, exemplos e perguntas frequentes — sempre filtrados para o que você tem acesso a usar.",
  },
  {
    seletor: '[data-tour="menu-usuario"]',
    titulo: "Sua conta",
    texto: "Sua foto, dados de contato, troca de senha, sessões ativas (aparelhos logados) e saída do sistema ficam todos centralizados aqui.",
  },
  {
    seletor: '[data-tour="sair"]',
    titulo: "Sair do sistema",
    texto: "Quando terminar, use esta opção para encerrar sua sessão com segurança. Pronto — explore os módulos do menu à vontade, e conte com a Central de Ajuda sempre que precisar.",
  },
];

const PASSOS_PORTAL: PassoTour[] = [
  {
    seletor: '[data-tour="portal-botao-ajuda"]',
    titulo: "Bem-vindo(a) ao seu Portal",
    texto: "Este é o seu espaço de autoatendimento. Este tour rápido mostra o que você pode fazer por aqui — refaça quando quiser pelo botão de ajuda, aqui em cima.",
  },
  {
    seletor: '[data-tour="portal-abrir-chamado"]',
    titulo: "Abrir Chamado",
    texto: "Use para relatar um problema técnico. Funciona mesmo sem internet: o chamado fica salvo neste aparelho e é enviado automaticamente assim que a conexão voltar.",
  },
  {
    seletor: '[data-tour="portal-solicitar-equipamento"]',
    titulo: "Solicitar Equipamento",
    texto: "Use para pedir um equipamento novo ou substituição, descrevendo o motivo do pedido.",
  },
  {
    seletor: '[data-tour="portal-mensagens"]',
    titulo: "Mensagens",
    texto: "Converse diretamente com o suporte ou sua equipe pelo chat interno.",
  },
  {
    seletor: '[data-tour="portal-meus-chamados"]',
    titulo: "Acompanhamento",
    texto: "Mais abaixo na tela, \"Meus chamados\" e \"Minhas solicitações\" mostram o andamento de tudo que você já abriu. Pronto — é só isso, autonomia total pra resolver o que precisar.",
  },
];

export function tourParaPapel(papel: Papel): { chave: string; passos: PassoTour[] } {
  if (papel === "COLABORADOR") return { chave: CHAVE_PORTAL, passos: PASSOS_PORTAL };
  return { chave: CHAVE_APPSHELL, passos: PASSOS_APPSHELL };
}
