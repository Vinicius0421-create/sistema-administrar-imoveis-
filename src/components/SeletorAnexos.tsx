import React, { useRef } from "react";
import { Paperclip, X } from "./icons";
import { Field } from "./ui";

// Mesmas regras de src/utils/anexos.ts no backend (MIME_TYPES_PERMITIDOS /
// TAMANHO_MAXIMO_BYTES) — validar aqui também evita que a pessoa só descubra
// que o arquivo é grande demais depois de esperar o upload inteiro (ou pior,
// depois de já ter sido salvo na fila offline, ver abrirChamado.ts).
const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;

// Item 1 da missão "Melhorias Adicionais" (08/07/2026) — até então nenhuma
// tela de abertura de chamado permitia anexar arquivo no ato (só depois,
// pelo detalhe do chamado já criado). Necessário agora porque a fila
// offline precisa capturar a foto no momento da abertura, sem depender de
// uma segunda visita à tela depois que a conexão voltar — mas funciona
// igual (e passa a valer) também no fluxo online normal.
export function SeletorAnexos({ arquivos, onChange, label = "Anexar fotos ou arquivos (opcional)" }: {
  arquivos: File[];
  onChange: (arquivos: File[]) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  function adicionarArquivos(lista: FileList | null) {
    if (!lista) return;
    setErro(null);
    const validos: File[] = [];
    for (const file of Array.from(lista)) {
      if (!TIPOS_ACEITOS.includes(file.type)) {
        setErro(`"${file.name}": tipo não permitido. Envie imagem (JPEG, PNG, WEBP, GIF) ou PDF.`);
        continue;
      }
      if (file.size > TAMANHO_MAXIMO_BYTES) {
        setErro(`"${file.name}" excede o tamanho máximo permitido (${Math.floor(TAMANHO_MAXIMO_BYTES / 1024 / 1024)}MB).`);
        continue;
      }
      validos.push(file);
    }
    if (validos.length > 0) onChange([...arquivos, ...validos]);
  }

  function remover(index: number) {
    onChange(arquivos.filter((_, i) => i !== index));
  }

  return (
    <Field label={label}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={TIPOS_ACEITOS.join(",")}
        className="hidden"
        onChange={(e) => {
          adicionarArquivos(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg py-3 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-400 transition-colors"
      >
        <Paperclip size={15} /> Escolher arquivo(s)
      </button>
      {erro && <p className="text-[11px] text-brand-700 dark:text-brand-400 mt-1">{erro}</p>}
      {arquivos.length > 0 && (
        <ul className="mt-2 space-y-1">
          {arquivos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700">
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => remover(i)} aria-label={`Remover ${f.name}`} className="text-gray-400 hover:text-brand-700 dark:hover:text-brand-400 flex-shrink-0">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}
