import { Papel } from "@prisma/client";

// Etapa 3 (auditoria de backend, 08/07/2026): esta constante estava
// copiada, com o texto idêntico, em 4 arquivos de rota diferentes
// (equipamentos.routes.ts, linhas.routes.ts, acessos.routes.ts,
// historico.routes.ts) — cada um decidindo sozinho quem "vê tudo" vs. só o
// próprio registro. O risco já se confirmou na prática: quando o papel RH
// foi criado (08/07/2026), foi preciso lembrar de editar as 4 cópias à mão
// — esquecer uma teria criado uma inconsistência silenciosa de autorização
// (RH veria tudo em 3 telas e ficaria restrito só na quarta, sem nenhum
// erro nem aviso). Centralizado aqui: só existe um lugar pra atualizar
// quando um papel novo entrar nessa lista.
//
// ADMINISTRADOR/GESTOR_COORDENADOR/SUPORTE_TI/RH têm visão completa;
// COLABORADOR só vê o que está vinculado à própria conta.
export const PAPEIS_QUE_VEEM_TUDO: Papel[] = ["ADMINISTRADOR", "GESTOR_COORDENADOR", "SUPORTE_TI", "RH"];
