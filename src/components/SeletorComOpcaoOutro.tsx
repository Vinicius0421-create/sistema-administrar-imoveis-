import React from "react";
import { Field, Select, TextInput } from "./ui";

// Achado de checkup (Fase 2, S7, 22/07/2026) — "item fora do catálogo, digite
// manualmente" era um padrão implementado de forma quase idêntica em pelo
// menos dois lugares: SolicitacoesPapelaria.tsx (ItemRowEditor, seleção de
// Produto dentro de uma Categoria) e Solicitacoes.tsx (SolicitacaoForm de
// Equipamento, seleção de Item dentro de uma Categoria). Os dois: um <Select>
// com as opções do catálogo (já filtradas pela categoria escolhida, quando
// aplicável) + uma opção sentinela "Outro / não cadastrado..." que revela um
// <TextInput> pra digitar o nome livremente. Extraído aqui como componente
// único, reaproveitado pelos dois — sem forçar os dois lados a terem os
// mesmos campos obrigatórios: quem decide o que é obrigatório continua sendo
// cada tela (a validação de "outro" preenchido ou não permanece no
// state/validação do formulário que usa este componente, não aqui).
//
// Chamados.tsx foi checado e NÃO usa este padrão (categoria de chamado é um
// <Select> simples, sem opção "outro"/campo livre) — nada a migrar lá.

export const SENTINELA_OUTRO = "__outro__";

export interface OpcaoCatalogo {
  id: string;
  nome: string;
}

interface SeletorComOpcaoOutroProps {
  // Rótulo do <Field> do Select principal (ex: "Produto", "Item").
  label: string;
  // "" = nada escolhido; SENTINELA_OUTRO = item fora do catálogo; qualquer
  // outro valor = id de uma opção do catálogo.
  value: string;
  // Recebe o valor bruto do <select> (pode ser "", um id do catálogo, ou
  // SENTINELA_OUTRO) — quem chama decide o que fazer com cada caso (ex:
  // preencher unidade de medida padrão do produto escolhido), preservando a
  // lógica específica que cada tela já tinha.
  onChange: (value: string) => void;
  opcoes: OpcaoCatalogo[];
  disabled?: boolean;
  placeholderVazio?: string;
  textoOpcaoOutro?: string;
  // Campo de texto livre, revelado só quando value === SENTINELA_OUTRO.
  valorLivre: string;
  onChangeValorLivre: (value: string) => void;
  labelCampoLivre?: string;
  placeholderCampoLivre?: string;
  autoFocusCampoLivre?: boolean;
  // Os dois usos existentes colocam o Select dentro de um grid de 2 colunas
  // (Categoria + Produto/Item) e o campo livre abaixo, ocupando a linha
  // inteira — "col-span-2" replica esse comportamento sem exigir que o
  // componente saiba em que grid está. Sobrescrevível caso um terceiro uso
  // futuro precise de outro layout.
  outroWrapperClassName?: string;
}

export function SeletorComOpcaoOutro({
  label,
  value,
  onChange,
  opcoes,
  disabled,
  placeholderVazio = "—",
  textoOpcaoOutro = "Outro / não cadastrado...",
  valorLivre,
  onChangeValorLivre,
  labelCampoLivre = "Nome do item (não está no catálogo)",
  placeholderCampoLivre,
  autoFocusCampoLivre = true,
  outroWrapperClassName = "col-span-2",
}: SeletorComOpcaoOutroProps) {
  const outroSelecionado = value === SENTINELA_OUTRO;
  return (
    <>
      <Field label={label}>
        <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">{placeholderVazio}</option>
          {opcoes.map((o) => (
            <option key={o.id} value={o.id}>{o.nome}</option>
          ))}
          <option value={SENTINELA_OUTRO}>{textoOpcaoOutro}</option>
        </Select>
      </Field>
      {outroSelecionado && (
        <div className={outroWrapperClassName}>
          <Field label={labelCampoLivre}>
            <TextInput
              value={valorLivre}
              onChange={(e) => onChangeValorLivre(e.target.value)}
              placeholder={placeholderCampoLivre}
              autoFocus={autoFocusCampoLivre}
            />
          </Field>
        </div>
      )}
    </>
  );
}
