// Ícones SVG simples e autocontidos — mesma abordagem do protótipo original,
// sem depender de um pacote externo de ícones.
import React from "react";

interface IconProps {
  size?: number;
  className?: string;
  // Favoritos (21/07/2026) — precisa pintar a estrela de preenchida
  // condicionalmente (cor dinâmica), o que uma className estática não
  // resolve sozinha. Opcional, repassado direto pro <svg>.
  style?: React.CSSProperties;
}

function makeIcon(paths: React.ReactNode) {
  return function Icon({ size = 18, className = "", style }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
      >
        {paths}
      </svg>
    );
  };
}

export const Home = makeIcon(<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>);
export const Users = makeIcon(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6" /><path d="M16 8.5a3 3 0 1 1 3 5.2" /><path d="M21 20c0-2.6-1.6-4.7-4-5.6" /></>);
export const Laptop = makeIcon(<><rect x="3" y="4" width="18" height="11" rx="1.5" /><path d="M2 19h20" /></>);
export const Phone = makeIcon(<rect x="6" y="2" width="12" height="20" rx="2" />);
export const Key = makeIcon(<><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9" /><path d="M16 6l2.5 2.5" /><path d="M13.5 8.5L16 11" /></>);
export const ShoppingCart = makeIcon(<><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h2l2.6 12.6a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 7H6" /></>);
export const Wrench = makeIcon(<path d="M14.7 6.3a4 4 0 1 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.6-.7-.7-2.6z" />);
export const Repeat = makeIcon(<><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>);
export const HistoryIcon = makeIcon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>);
export const Plus = makeIcon(<><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const X = makeIcon(<><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>);
export const Search = makeIcon(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>);
export const ChevronRight = makeIcon(<path d="M9 6l6 6-6 6" />);
export const ChevronLeft = makeIcon(<path d="M15 6l-6 6 6 6" />);
export const MoreVertical = makeIcon(<><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" /></>);
export const AlertTriangle = makeIcon(<><path d="M10.6 3.5L1.8 19a1.5 1.5 0 0 0 1.3 2.2h17.8a1.5 1.5 0 0 0 1.3-2.2L13.4 3.5a1.5 1.5 0 0 0-2.8 0z" /><path d="M12 9.5v4" /><path d="M12 17h.01" /></>);
export const CheckCircle2 = makeIcon(<><circle cx="12" cy="12" r="9" /><path d="M8.5 12.3l2.3 2.3 4.7-5.2" /></>);
export const Package = makeIcon(<><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5L12 12l8.5-4.5" /><path d="M12 12v9" /></>);
export const ArrowLeftRight = makeIcon(<><path d="M7 4L3 8l4 4" /><path d="M3 8h13" /><path d="M17 12l4 4-4 4" /><path d="M21 16H8" /></>);
export const ClipboardList = makeIcon(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3v2h6V3" /><path d="M9 11h6" /><path d="M9 15h6" /><path d="M9 7h6" /></>);
export const UserCircle2 = makeIcon(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18a5.5 5.5 0 0 1 11 0" /></>);
export const Menu = makeIcon(<><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>);
export const ArrowLeft = makeIcon(<><path d="M19 12H5" /><path d="M11 18l-6-6 6-6" /></>);
export const LogOut = makeIcon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>);
export const Settings = makeIcon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
export const Toggle = makeIcon(<><rect x="1" y="5" width="22" height="14" rx="7" /><circle cx="16" cy="12" r="3" /></>);
export const Send = makeIcon(<><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>);
export const Paperclip = makeIcon(<path d="M21.4 11.1l-9.2 9.2a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />);
export const Download = makeIcon(<><path d="M12 3v13" /><path d="M7 11l5 5 5-5" /><path d="M4 21h16" /></>);
export const FileText = makeIcon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17h6" /></>);
export const Pencil = makeIcon(<><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /><path d="M15 5l4 4" /></>);
export const Eye = makeIcon(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOff = makeIcon(<><path d="M17.9 17.9A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a19.4 19.4 0 0 1 4.2-5.4M9.9 4.2A10.6 10.6 0 0 1 12 4c7 0 11 8 11 8a19.4 19.4 0 0 1-2.3 3.3" /><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" /><path d="M1 1l22 22" /></>);
// Chat interno (07/07/2026) — balão de mensagem, não existia nenhum ícone de
// conversa no conjunto ainda.
export const MessageCircle = makeIcon(<path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 9 9 0 0 1-3.6-.7L3 21l1.8-5.5A8.4 8.4 0 1 1 21 11.5z" />);
export const Video = makeIcon(<><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>);
export const Lock = makeIcon(<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>);
// Adicionados para o Menu Centralizado do Usuário (08/07/2026, item 3 da
// missão "Melhorias Adicionais") — mesmo padrão dos demais: SVG simples,
// sem pacote externo.
export const Camera = makeIcon(<><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="14" r="3.5" /></>);
export const ChevronDown = makeIcon(<path d="M6 9l6 6 6-6" />);
// Reordenar por teclado (achado A3 do check-up, 22/07/2026) — par do
// ChevronDown acima (mesmo desenho, espelhado verticalmente), usado nos
// botões "▲"/"▼" de reordenar fotos/anexos de equipamento.
export const ChevronUp = makeIcon(<path d="M6 15l6-6 6 6" />);
export const Trash2 = makeIcon(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></>);
export const Monitor = makeIcon(<><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></>);
// Preferências → Tema (10/07/2026).
export const Sun = makeIcon(<><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5" /><path d="M12 19.5V22" /><path d="M4.2 4.2l1.8 1.8" /><path d="M18 18l1.8 1.8" /><path d="M2 12h2.5" /><path d="M19.5 12H22" /><path d="M4.2 19.8l1.8-1.8" /><path d="M18 6l1.8-1.8" /></>);
export const Moon = makeIcon(<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />);
// Adicionados para a Central de Ajuda + Tour Guiado (08/07/2026, item 4 da
// missão "Melhorias Adicionais").
export const HelpCircle = makeIcon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 1.9v.3" /><path d="M12 17h.01" /></>);
export const Sparkles = makeIcon(<><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>);
// Central de Notificações (Fase B, 09/07/2026, pedido do Vini) — sino padrão
// e "olho riscado"/mudo para o estado silenciado nas preferências.
export const Bell = makeIcon(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>);
export const BellOff = makeIcon(<><path d="M8.7 3a6 6 0 0 1 9.3 5c0 3.4.8 5.7 1.6 7.1" /><path d="M18 14.5c-.6-1.6-1-3.6-1-6.5a6 6 0 0 0-6-6c-.6 0-1.1.1-1.6.2" /><path d="M3 3l18 18" /><path d="M3 17s3-2 3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>);
export const CheckCheck = makeIcon(<><path d="M2 12.5l4.5 4.5L18 5.5" /><path d="M8 12.5l4.5 4.5L23.5 5.5" /></>);
export const Filter = makeIcon(<path d="M4 4h16l-6.5 8v6l-3 2v-8z" />);

// Calendário de Aniversários (17/07/2026) — ícone de bolo, mesmo estilo
// "feather" autocontido dos demais (sem depender de pacote externo).
export const Cake = makeIcon(<><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" /><path d="M4 16c1 1 2 1 3 0s2-1 3 0 2 1 3 0 2-1 3 0 2 1 3 0" /><path d="M12 11V7" /><path d="M9 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 1 1 3 0" /><path d="M2 21h20" /></>);

// Pagamentos CNAB (20/07/2026) — nota de dinheiro pro item de menu e ações
// do módulo de pagamentos, e seta de upload pra importação do retorno.
export const Banknote = makeIcon(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>);
export const Upload = makeIcon(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></>);

// Redesenho da Central de Comunicação (21/07/2026) — estrela pra Favoritos
// (preenchida quando favoritado, contorno quando não), megafone pro canal
// de Avisos/Empresa, prédio pro agrupamento por Unidade na árvore de canais.
export const Star = makeIcon(<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.6L12 17.5l-5.8 3.1 1.1-6.6-4.8-4.6 6.6-.9z" />);
export const Megaphone = makeIcon(<><path d="M3 11v2a2 2 0 0 0 2 2h1l1 5h2l-1-5h1l9 4V7l-9 4H5a2 2 0 0 0-2 2z" /><path d="M17 7a4 4 0 0 1 0 8" /></>);
export const Building2 = makeIcon(<><path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" /><path d="M14 9h5a1 1 0 0 1 1 1v11" /><path d="M4 21h16" /><path d="M8 7h1M8 11h1M8 15h1M14 12h1M14 16h1" /></>);

// Fase 2 da Central de Comunicação (21/07/2026) — alfinete pra mensagem
// fixada, carinha pra reação em emoji, seta de canto pra "responder em
// thread".
export const Pin = makeIcon(<><path d="M12 17v5" /><path d="M8 10.5V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4.5l2 3.5H6z" /></>);
export const Smile = makeIcon(<><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" /></>);
export const CornerUpLeft = makeIcon(<><path d="M9 14l-5-5 5-5" /><path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5V20" /></>);

// Achado M2 do check-up (Fase 2, 22/07/2026) — Mensagens.tsx tinha 2 ícones
// de clipe de papel (Paperclip) na mesma tela fazendo coisas diferentes:
// "anexar arquivo nesta mensagem" (continua Paperclip) e "ver arquivos já
// compartilhados nesta conversa" (passa a usar esta pasta, sem ambiguidade).
export const Folder = makeIcon(<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.8 2H19.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />);
// Achado M6 do check-up (Fase 2, 22/07/2026) — kebab de "mais ações" na
// bolha de mensagem, agrupando o que era antes 3 botões sempre visíveis no
// hover (reagir/responder/fixar) em: reagir direto + este menu pro resto.
export const MoreHorizontal = makeIcon(<><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></>);
