// Importação de usuários do Imoview (08/07/2026, pedido do Vini).
//
// Contexto: o Imoview não oferece uma API de nível empresa pra listar
// usuários/corretores — só endpoints escopados a login individual de app
// (investigação registrada em colaboradores.routes.ts, rota
// /colaboradores/importar-imoview/preview). Caminho combinado com o Vini:
// ele exporta a tela "Usuários" do Imoview em .xlsx e sobe aqui.
//
// Este componente só faz REVISÃO — a rota de preview no backend nunca grava
// nada, e cada linha confirmada aqui vira uma chamada normal de
// colaboradoresApi.create(), a mesma usada no formulário manual "Novo
// Colaborador". CPF nunca vem do Imoview (confirmado ao inspecionar o
// arquivo real: colunas Codigo/CodigoAuxiliar/Foto/Nome/Situacao/Cargo/
// Perfil/Setor/Email/Telefone/Creci/UltimoAcesso, sem CPF nenhum) — por
// isso é sempre obrigatório digitar à mão antes de incluir uma linha,
// igual ao caso da Viviane/Elisiane/Letícia em 07/07/2026.
import React, { useRef, useState } from "react";
import { AppData } from "../hooks/useAppData";
import { colaboradoresApi, ImportarImoviewLinha, ImportarImoviewPreview } from "../api/colaboradores";
import { ApiError } from "../lib/apiClient";
import { Button, Field, Modal, Select, Spinner, TextInput } from "../components/ui";
import { CheckCircle2, Paperclip, X } from "../components/icons";
import { StatusColaborador, STATUS_COLABORADOR_LABEL } from "../types";
import { maskCpf } from "../lib/mascaras";

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Sugestão de setor/cargo — best-effort, sempre revisável pelo admin antes de
// confirmar. O Imoview manda um "Setor" grosseiro (Ambos/Venda/Aluguel) que
// não bate 1:1 com os ~20 setores nossos, então a pista mais confiável
// geralmente está no próprio texto do Cargo (ex: "Gerente de locação" já diz
// tudo). Cargo é escopado por Setor no nosso cadastro (mesmo nome — ex:
// "Gerente" — se repete uma vez por setor), então só sugerimos um cargoId
// depois de já ter uma sugestão de setor.
function sugerirSetorECargo(
  setores: AppData["dominios"]["setores"],
  cargos: AppData["dominios"]["cargos"],
  cargoImoview: string,
  setorImoview: string
): { setorId: string; cargoId: string } {
  const alvo = normalizar(`${cargoImoview} ${setorImoview}`);
  let setor =
    setores.find((s) => alvo.includes(normalizar(s.nome))) ||
    (normalizar(setorImoview) === "aluguel" ? setores.find((s) => normalizar(s.nome) === "locacao") : undefined) ||
    (normalizar(setorImoview) === "venda" ? setores.find((s) => normalizar(s.nome) === "vendas") : undefined);

  if (!setor) return { setorId: "", cargoId: "" };

  const nomeCompleto = normalizar(cargoImoview);
  const nomeBase = nomeCompleto.split(" de ")[0].trim();
  const cargo =
    cargos.find((c) => c.setorId === setor!.id && normalizar(c.nome) === nomeCompleto) ||
    cargos.find((c) => c.setorId === setor!.id && normalizar(c.nome) === nomeBase);

  return { setorId: setor.id, cargoId: cargo?.id ?? "" };
}

interface LinhaEditavel extends ImportarImoviewLinha {
  incluir: boolean;
  cpf: string;
  unidadeId: string;
  setorId: string;
  cargoId: string;
  status: StatusColaborador;
}

export function ImportarImoviewModal({
  data,
  onClose,
  onImportado,
}: {
  data: AppData;
  onClose: () => void;
  onImportado: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportarImoviewPreview | null>(null);
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: number; falhas: { nome: string; erro: string }[] } | null>(null);

  async function selecionarArquivo(file: File) {
    setErroArquivo(null);
    setResultado(null);
    setCarregando(true);
    try {
      const resp = await colaboradoresApi.importarImoviewPreview(file);
      setPreview(resp);
      setLinhas(
        resp.linhas
          .filter((l) => !l.existente)
          .map((l) => {
            const sugestao = sugerirSetorECargo(data.dominios.setores, data.dominios.cargos, l.cargoImoview, l.setorImoview);
            return {
              ...l,
              incluir: true,
              cpf: "",
              unidadeId: "",
              setorId: sugestao.setorId,
              cargoId: sugestao.cargoId,
              status: l.statusSugerido,
            };
          })
      );
    } catch (e) {
      setErroArquivo(e instanceof ApiError ? e.message : "Não consegui processar o arquivo.");
    } finally {
      setCarregando(false);
    }
  }

  function atualizarLinha(indice: number, patch: Partial<LinhaEditavel>) {
    setLinhas((prev) => prev.map((l, i) => (i === indice ? { ...l, ...patch } : l)));
  }

  function cargosDoSetor(setorId: string) {
    return data.dominios.cargos.filter((c) => c.setorId === setorId);
  }

  async function importar() {
    setImportando(true);
    const selecionadas = linhas.filter((l) => l.incluir);
    let ok = 0;
    const falhas: { nome: string; erro: string }[] = [];

    for (const l of selecionadas) {
      if (!l.cpf.trim()) {
        falhas.push({ nome: l.nome, erro: "CPF não preenchido — linha pulada." });
        continue;
      }
      try {
        await colaboradoresApi.create({
          nomeCompleto: l.nome,
          cpf: l.cpf,
          contaFuncao: false,
          email: l.email || null,
          // Múltiplos telefones (07/08/2026) — o Imoview só traz um número
          // por pessoa, então vira um único item da lista (principal).
          telefones: l.telefone ? [{ numero: l.telefone, principal: true }] : [],
          unidadeId: l.unidadeId || null,
          setorId: l.setorId || null,
          cargoId: l.cargoId || null,
          status: l.status,
        });
        ok++;
      } catch (e) {
        falhas.push({ nome: l.nome, erro: e instanceof ApiError ? e.message : "Erro desconhecido." });
      }
    }

    setImportando(false);
    setResultado({ ok, falhas });
    // Tira do formulário quem já foi criado com sucesso — só sobra o que
    // falhou (ex: CPF inválido), pra dar pra corrigir e tentar de novo sem
    // reimportar tudo. Recarrega a lista de colaboradores em qualquer caso.
    if (ok > 0) {
      const nomesComFalha = new Set(falhas.map((f) => f.nome));
      setLinhas((prev) => prev.filter((l) => !l.incluir || nomesComFalha.has(l.nome)));
      onImportado();
    }
  }

  return (
    <Modal title="Importar usuários do Imoview" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {!preview && (
          <>
            <p className="text-slate-600 dark:text-slate-400">
              Exporte a tela <strong>Usuários</strong> do Imoview em Excel (.xlsx) e envie o arquivo aqui. Nada é
              criado automaticamente — você revisa e confirma cada colaborador novo antes de incluir.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) selecionarArquivo(file);
              }}
            />
            <Button variant="accent" onClick={() => inputRef.current?.click()} disabled={carregando}>
              {carregando ? (
                <span className="inline-flex items-center gap-2 animate-[fadeIn_var(--motion-fast)_ease-out]">
                  <Spinner size={14} /> Processando...
                </span>
              ) : (
                <>
                  <Paperclip size={16} /> Selecionar arquivo .xlsx
                </>
              )}
            </Button>
            {erroArquivo && (
              <p className="text-xs animate-[fadeIn_var(--motion-fast)_ease-out] bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 rounded-[var(--radius-control)] p-2">{erroArquivo}</p>
            )}
          </>
        )}

        {preview && (
          <>
            <div className="bg-gray-50 dark:bg-slate-800 rounded-[var(--radius-card)] border border-gray-100 p-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <span><strong>{preview.resumo.total}</strong> linhas no arquivo</span>
              <span className="text-emerald-700 dark:text-emerald-400"><strong>{preview.resumo.existentes}</strong> já cadastrados (e-mail já existe — ignorados)</span>
              <span className="text-brand-700 dark:text-brand-400"><strong>{preview.resumo.novos}</strong> novos, pra revisar abaixo</span>
            </div>

            {resultado && (
              <div className="bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-800 rounded-[var(--radius-control)] p-3 text-xs space-y-1">
                <p className="text-emerald-800 dark:text-emerald-300 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> {resultado.ok} colaborador(es) criado(s) com sucesso.
                </p>
                {resultado.falhas.length > 0 && (
                  <div className="text-brand-700 dark:text-brand-400">
                    <p className="font-semibold">{resultado.falhas.length} não entraram — corrija e tente de novo:</p>
                    <ul className="list-disc list-inside">
                      {resultado.falhas.map((f, i) => (
                        <li key={i}>{f.nome}: {f.erro}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {linhas.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500">Nenhuma linha nova pra revisar — todo mundo do arquivo já está cadastrado.</p>
            ) : (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {linhas.map((l, i) => (
                  <div key={i} className={`border rounded-[var(--radius-card)] p-3 shadow-[var(--elevation-1)] ${l.incluir ? "border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900" : "border-gray-100 bg-gray-50 dark:bg-slate-800 opacity-60"}`}>
                    <div className="flex items-start gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={l.incluir}
                        onChange={(e) => atualizarLinha(i, { incluir: e.target.checked })}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 break-words">{l.nome}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500 break-words">
                          {l.email} · Imoview: {l.cargoImoview || "—"} / {l.setorImoview || "—"}
                        </p>
                      </div>
                    </div>
                    {l.incluir && (
                      <div className="grid sm:grid-cols-2 gap-3 pl-6">
                        <Field label="CPF (obrigatório — o Imoview não fornece)">
                          <TextInput
                            value={l.cpf}
                            onChange={(e) => atualizarLinha(i, { cpf: maskCpf(e.target.value) })}
                            placeholder="000.000.000-00"
                          />
                        </Field>
                        <Field label="Status">
                          <Select value={l.status} onChange={(e) => atualizarLinha(i, { status: e.target.value as StatusColaborador })}>
                            {Object.entries(STATUS_COLABORADOR_LABEL).map(([v, label]) => (
                              <option key={v} value={v}>{label}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Unidade">
                          <Select value={l.unidadeId} onChange={(e) => atualizarLinha(i, { unidadeId: e.target.value })}>
                            <option value="">—</option>
                            {data.dominios.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                          </Select>
                        </Field>
                        <Field label="Setor">
                          <Select
                            value={l.setorId}
                            onChange={(e) => atualizarLinha(i, { setorId: e.target.value, cargoId: "" })}
                          >
                            <option value="">—</option>
                            {data.dominios.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                          </Select>
                        </Field>
                        <Field label="Cargo">
                          <Select
                            value={l.cargoId}
                            onChange={(e) => atualizarLinha(i, { cargoId: e.target.value })}
                            disabled={!l.setorId}
                          >
                            <option value="">—</option>
                            {cargosDoSetor(l.setorId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                          </Select>
                        </Field>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="ghost" onClick={onClose}>Fechar</Button>
              {linhas.some((l) => l.incluir) && (
                <Button variant="primary" onClick={importar} disabled={importando}>
                  {importando ? (
                    <span className="inline-flex items-center gap-2 animate-[fadeIn_var(--motion-fast)_ease-out]">
                      <Spinner size={14} /> Importando...
                    </span>
                  ) : (
                    `Importar ${linhas.filter((l) => l.incluir).length} selecionado(s)`
                  )}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
