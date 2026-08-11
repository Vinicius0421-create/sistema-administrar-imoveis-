import React, { useState } from "react";
import { AppData } from "../hooks/useAppData";
import { Papel } from "../types";
import { SolicitacoesPage } from "./Solicitacoes";
import { SolicitacoesServicoPage } from "./SolicitacoesServico";
import { SolicitacoesPapelariaPage } from "./SolicitacoesPapelaria";

// Hub da aba "Solicitações" (09/07/2026, pedido do Vini) — desde a criação
// do submódulo de Papelaria e Compras, "Solicitações" deixou de significar
// só Equipamentos e virou um espaço com 2 frentes. Este componente é só o
// alternador entre elas; cada página continua 100% independente (dados,
// permissões, formulário, Kanban próprios).
//
// RH — até 22/07/2026 enxergava só a aba de Papelaria e Compras (alternador
// nem aparecia pra ele). Removido a pedido do Vini ("os papéis RH e
// financeiro devem ter as mesmas abas... e etc", confirmado que inclui
// igualar Solicitações): hoje RH vê o alternador completo (Equipamentos +
// Papelaria e Compras + Serviços), com os mesmos poderes de FINANCEIRO em
// cada uma (`podeGerenciarPapelaria`/`podeAprovarCusto` abaixo já incluíam
// RH ou passaram a incluir).
//
// SUPORTE_TI (14/07/2026, pedido do Vini: "solicitação de equipamento tem
// que estar habilitado para o técnico, apenas as de equipamento") — espelho
// exato do caso RH acima, só que na direção oposta: enxerga só a aba
// Equipamentos, nunca Papelaria e Compras (`somenteEquipamento` abaixo).
//
// Aprovação em DUAS ETAPAS (17/07/2026, reorganização de hierarquia + papel
// FINANCEIRO — ver comentário completo em solicitacoes.routes.ts):
//   `podeValidarTecnicamente` (ADMINISTRADOR/SUPORTE_TI) — 1ª etapa,
//   PENDENTE → EM_ANALISE, veto técnico.
//   `podeAprovarCusto` (ADMINISTRADOR/FINANCEIRO/RH, RH incluído em
//   22/07/2026 — igualar RH e Financeiro) — 2ª etapa, decide
//   APROVADO/REPROVADO, só depois que já passou por EM_ANALISE.
// GESTOR_COORDENADOR não entra em nenhuma das duas — perdeu a aprovação de
// equipamento (que era dele desde 14/07) pro Financeiro/Suporte-TI, mas
// continua com `podeExcluirEquipamento` (limpar solicitação criada por
// engano) e pode continuar criando solicitação em nome do time — identidade
// nova é "acompanha a operação sem decidir custo".
//
// Papelaria e Compras (`podeGerenciarPapelaria` abaixo): GESTOR_COORDENADOR
// também saiu da gestão/aprovação (ficou só com RH + FINANCEIRO +
// ADMINISTRADOR, ver PAPEIS_GERENCIAM em solicitacoesPapelaria.routes.ts),
// mas mantém a visão completa da lista (ver `ehAutoatendimentoSemGestao` lá)
// e a criação em nome do time — mesmo padrão do lado Equipamentos.
interface Props {
  data: AppData;
  papel: Papel;
  onChangedEquipamento: () => void;
  onChangedPapelaria: () => void;
  // Semente vinda do dashboard (ver Home.tsx) — hoje só existe pra
  // Solicitação de Equipamento; ao clicar, o hub já garante que a aba
  // Equipamentos fica ativa antes de repassar o id.
  abrirSolicitacaoId?: string;
  // Pop-up de notificação clicável (09/07/2026, pedido do Vini) — mesma
  // ideia de `abrirSolicitacaoId` acima, só que pro lado de Papelaria e
  // Compras: garante a aba "Papelaria e Compras" ativa antes de repassar o
  // id pro `abrirSolicitacaoId` que `SolicitacoesPapelariaPage` já aceitava
  // (usado até aqui só pelo Portal do Colaborador, nunca vindo de fora dele).
  abrirSolicitacaoPapelariaId?: string;
  // Atalho rápido do Dashboard (Fase 3, 14/07/2026) — hoje só existe pra
  // Equipamentos (mesma aba padrão do hub), mesmo racional de
  // abrirSolicitacaoId acima.
  abrirNovo?: boolean;
  // Busca Global (Onda 2.1 do redesign, 21/07/2026) — um resultado de tipo
  // "sol_servico" precisa forçar a aba "servicos" (a única das 3 sem um
  // sinal implícito próprio, ao contrário de abrirSolicitacaoId/
  // abrirSolicitacaoPapelariaId acima, que já bastam pra deduzir a aba).
  abrirAba?: "equipamentos" | "papelaria" | "servicos";
  abrirSolicitacaoServicoId?: string;
}

function classePilula(ativa: boolean): string {
  return `px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors duration-[var(--motion-fast)] ${ativa ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200"}`;
}

export function SolicitacoesHub({
  data,
  papel,
  onChangedEquipamento,
  onChangedPapelaria,
  abrirSolicitacaoId,
  abrirSolicitacaoPapelariaId,
  abrirNovo,
  abrirAba,
  abrirSolicitacaoServicoId,
}: Props) {
  // RH deixou de ser restrito só à aba Papelaria em 22/07/2026 (pedido do
  // Vini: "os papéis RH e financeiro devem ter as mesmas abas... e etc" —
  // confirmado que inclui igualar Solicitações). Antes só RH tinha esta
  // restrição de aba única; hoje nenhum papel de "gestão financeira" tem —
  // RH vê o alternador de 3 abas completo, igual FINANCEIRO (o antigo
  // `somentePapelaria`, que só existia pra RH, foi removido por completo).
  // Só SUPORTE_TI continua com alternador restrito (2 abas — ver
  // `somenteEquipamento`), por motivo técnico não relacionado a esta
  // equiparação.
  const somenteEquipamento = papel === "SUPORTE_TI";
  // Default "Equipamentos" pra ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI —
  // preserva o hábito de quem já usa "Solicitações" há tempos pra
  // equipamento; também é a aba certa pra receber um clique vindo do
  // dashboard (abrirSolicitacaoId hoje só existe pra Solicitação de
  // Equipamento, ver Home.tsx). Um clique vindo de uma notificação de
  // Papelaria, por outro lado, já chega sabendo que precisa da outra aba —
  // `abrirSolicitacaoPapelariaId` sobrescreve o default acima só nesse caso
  // (e não se aplica a SUPORTE_TI, que nunca recebe notificação de Papelaria).
  // `abrirAba` (Busca Global, Onda 2.1) tem prioridade sobre tudo — é um
  // sinal explícito, não deduzido de qual id veio preenchido.
  const [aba, setAba] = useState<"equipamentos" | "papelaria" | "servicos">(
    abrirAba || (abrirSolicitacaoPapelariaId ? "papelaria" : "equipamentos")
  );

  // Duas etapas (17/07/2026) — ver comentário no topo do arquivo. RH
  // incluído em 22/07/2026 (pedido do Vini — igualar RH e Financeiro,
  // inclusive Solicitações), ver PAPEIS_QUE_APROVAM em solicitacoes.routes.ts.
  const podeValidarTecnicamente = papel === "ADMINISTRADOR" || papel === "SUPORTE_TI";
  const podeAprovarCusto = papel === "ADMINISTRADOR" || papel === "FINANCEIRO" || papel === "RH";
  // Exclusão continua com o mesmo poder de sempre (ADMINISTRADOR/
  // GESTOR_COORDENADOR — ver requireRole do DELETE em
  // solicitacoes.routes.ts, inalterado) — desacoplada de quem
  // valida/aprova, mesmo depois da reorganização de 17/07: Gestor perdeu a
  // decisão técnica e a de custo, mas continua podendo limpar uma
  // solicitação criada por engano em nome do time (ver comentário de
  // `podeExcluir` em Solicitacoes.tsx).
  const podeExcluirEquipamento = papel === "ADMINISTRADOR" || papel === "GESTOR_COORDENADOR";
  // Reorganização de hierarquia (17/07/2026): GESTOR_COORDENADOR saiu da
  // gestão de Papelaria e Compras (ver PAPEIS_GERENCIAM em
  // solicitacoesPapelaria.routes.ts — hoje ADMINISTRADOR/RH/FINANCEIRO).
  // COLABORADOR nunca tem este item no menu (NAV em App.tsx) e SUPORTE_TI
  // tem "Solicitações" no menu mas só enxerga a aba Equipamentos
  // (`somenteEquipamento` acima) — nenhum dos dois chega a montar
  // `SolicitacoesPapelariaPage`.
  const podeGerenciarPapelaria = papel === "ADMINISTRADOR" || papel === "RH" || papel === "FINANCEIRO";

  return (
    <div>
      {!somenteEquipamento && (
        <div className="flex gap-1 bg-slate-100 rounded-full p-1 mb-4 w-fit">
          <button onClick={() => setAba("equipamentos")} className={classePilula(aba === "equipamentos")}>
            Equipamentos
          </button>
          <button onClick={() => setAba("papelaria")} className={classePilula(aba === "papelaria")}>
            Papelaria e Compras
          </button>
          <button onClick={() => setAba("servicos")} className={classePilula(aba === "servicos")}>
            Serviços
          </button>
        </div>
      )}
      {/* SUPORTE_TI não vê Papelaria, mas Serviços é DELE (é quem atende) —
          ganha o alternador Equipamentos/Serviços (20/07/2026). */}
      {somenteEquipamento && (
        <div className="flex gap-1 bg-slate-100 rounded-full p-1 mb-4 w-fit">
          <button onClick={() => setAba("equipamentos")} className={classePilula(aba === "equipamentos")}>
            Equipamentos
          </button>
          <button onClick={() => setAba("servicos")} className={classePilula(aba === "servicos")}>
            Serviços
          </button>
        </div>
      )}

      {/* Padronização de Animações (10/07/2026): mesmo tratamento de
          Linhas.tsx — troca de aba local usa `pageIn` mais rápido
          (--motion-fast), reaproveitando a transição já usada pra troca de
          módulo inteiro, só que numa escala mais contida. */}
      <div key={aba} className="animate-[pageIn_var(--motion-fast)_var(--motion-ease)]">
        {aba === "servicos" ? (
          <SolicitacoesServicoPage data={data} papel={papel} abrirSolicitacaoId={abrirSolicitacaoServicoId} />
        ) : !somenteEquipamento && aba === "papelaria" ? (
          <SolicitacoesPapelariaPage
            data={data}
            papel={papel}
            readOnly={false}
            podeGerenciar={podeGerenciarPapelaria}
            onChanged={onChangedPapelaria}
            abrirSolicitacaoId={abrirSolicitacaoPapelariaId}
          />
        ) : (
          <SolicitacoesPage
            data={data}
            readOnly={false}
            podeValidarTecnicamente={podeValidarTecnicamente}
            podeAprovarCusto={podeAprovarCusto}
            aprovadorTemOverride={papel === "ADMINISTRADOR"}
            podeExcluir={podeExcluirEquipamento}
            onChanged={onChangedEquipamento}
            abrirSolicitacaoId={abrirSolicitacaoId}
            abrirNovo={abrirNovo}
          />
        )}
      </div>
    </div>
  );
}
