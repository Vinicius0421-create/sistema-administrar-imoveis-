-- Correção de bug próprio (12/08/2026): a migration 20260811150000 esqueceu
-- de incluir 'DOCUMENTO_VENCIDO' em TipoNotificacao, apesar do job
-- documentosVencimentoJob.ts já usar esse valor para documento aprovado que
-- venceu (distinto de DOCUMENTO_VENCENDO, que é o alerta de proximidade).
-- Só seria descoberto em produção quando o primeiro documento realmente
-- vencesse — achado antes disso, via auditoria de schema drift.
ALTER TYPE "TipoNotificacao" ADD VALUE 'DOCUMENTO_VENCIDO';
