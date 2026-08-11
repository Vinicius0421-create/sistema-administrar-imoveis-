// Precisa ser o PRIMEIRO import de todo o processo (antes até do Fastify) —
// é assim que o Sentry consegue instrumentar automaticamente bibliotecas
// carregadas depois. Ver import "./instrument" no topo de src/server.ts.
//
// Sem SENTRY_DSN configurado (variável opcional em src/env.ts), o SDK
// simplesmente não envia nada — dev local e qualquer ambiente sem a
// variável continuam funcionando exatamente como antes, sem erro.
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    // Amostragem de performance (traces) baixa de propósito — o objetivo
    // aqui é capturar ERROS, não fazer profiling detalhado de toda
    // requisição. 10% já dá visibilidade de latência sem gastar cota do
    // plano gratuito do Sentry à toa.
    tracesSampleRate: 0.1,
  });
}
