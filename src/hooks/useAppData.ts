import { useCallback, useEffect, useState } from "react";
import { colaboradoresApi } from "../api/colaboradores";
import { equipamentosApi } from "../api/equipamentos";
import { linhasApi } from "../api/linhas";
import { acessosApi } from "../api/acessos";
import { lotesApi } from "../api/lotes";
import { solicitacoesApi } from "../api/solicitacoes";
import { chamadosApi } from "../api/chamados";
import { movimentacoesApi } from "../api/movimentacoes";
import { historicoApi } from "../api/historico";
import { dominiosApi } from "../api/dominios";
import { solicitacoesPapelariaApi } from "../api/solicitacoesPapelaria";
import {
  AcessoSistema, AcessorioEquipamento, Cargo, CategoriaEquipamento, CategoriaProdutoEquipamento, CategoriaProdutoPapelaria,
  ChamadoManutencao, Colaborador, Empresa, Equipamento, HistoricoTroca, LinhaTelefonica, LoteRateio, MarcaEquipamento,
  MovimentacaoColaborador, ProdutoEquipamento, ProdutoPapelaria, SistemaAcesso, Setor, SolicitacaoEquipamento,
  SolicitacaoPapelaria, Unidade,
} from "../types";
import { Papel } from "../types";

export interface AppData {
  colaboradores: Colaborador[];
  equipamentos: Equipamento[];
  linhas: LinhaTelefonica[];
  acessos: AcessoSistema[];
  lotes: LoteRateio[];
  solicitacoes: SolicitacaoEquipamento[];
  chamados: ChamadoManutencao[];
  movimentacoes: MovimentacaoColaborador[];
  historico: HistoricoTroca[];
  // Papelaria e Compras (09/07/2026) — só buscada para quem tem acesso ao
  // submódulo (ADMINISTRADOR/GESTOR_COORDENADOR/RH, ver
  // PAPEIS_GERENCIAM em solicitacoesPapelaria.routes.ts); fica vazia pros
  // demais, mesmo racional de `podeVerMovimentacoes` abaixo.
  solicitacoesPapelaria: SolicitacaoPapelaria[];
  dominios: {
    unidades: Unidade[];
    setores: Setor[];
    cargos: Cargo[];
    empresas: Empresa[];
    sistemas: SistemaAcesso[];
    categoriasEquipamento: CategoriaEquipamento[];
    marcasEquipamento: MarcaEquipamento[];
    categoriasProdutoPapelaria: CategoriaProdutoPapelaria[];
    produtosPapelaria: ProdutoPapelaria[];
    categoriasProdutoEquipamento: CategoriaProdutoEquipamento[];
    produtosEquipamento: ProdutoEquipamento[];
    acessoriosEquipamento: AcessorioEquipamento[];
  };
}

type ResourceKey = keyof Omit<AppData, "dominios">;

const EMPTY: AppData = {
  colaboradores: [], equipamentos: [], linhas: [], acessos: [], lotes: [],
  solicitacoes: [], chamados: [], movimentacoes: [], historico: [], solicitacoesPapelaria: [],
  dominios: {
    unidades: [], setores: [], cargos: [], empresas: [], sistemas: [],
    categoriasEquipamento: [], marcasEquipamento: [], categoriasProdutoPapelaria: [], produtosPapelaria: [],
    categoriasProdutoEquipamento: [], produtosEquipamento: [], acessoriosEquipamento: [],
  },
};

// Carrega tudo de uma vez ao entrar no sistema (equivalente ao antigo
// loadData() do protótipo, só que buscando da API real em vez de
// window.storage). `movimentacoes` só é buscada para papéis que têm
// permissão na rota (Admin/Gestor) — para os demais fica vazia, sem gerar
// erro 403 no console.
export function useAppData(papel: Papel | null) {
  const [data, setData] = useState<AppData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregarTudo = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const podeVerMovimentacoes = papel === "ADMINISTRADOR" || papel === "GESTOR_COORDENADOR";
      // Colaborador comum não tem tela nenhuma que use `historico` (só
      // Historico.tsx usa, e essa página nem aparece no menu dele) — pular a
      // busca evita carregar dado à toa no celular dele, além de já não
      // depender só da trava por papel que a API aplica (ver
      // historico.routes.ts, corrigido em 06/07/2026 pra escopar por
      // colaborador em vez de devolver o histórico de custódia inteiro).
      const podeVerHistorico = papel !== "COLABORADOR";
      // Quem busca solicitacoesPapelaria: os 3 papéis de PAPEIS_GERENCIAM
      // (gestão total do módulo) — e também COLABORADOR e, desde
      // 09/07/2026 ("Meu Portal": todo papel não-ADMINISTRADOR também é um
      // colaborador), SUPORTE_TI — os dois só recebem de volta as PRÓPRIAS
      // solicitações (o backend já escopa isso sozinho em
      // GET /solicitacoes-papelaria — ver escopoColaborador/
      // ehAutoatendimentoSemGestao em solicitacoesPapelaria.routes.ts —
      // então não tem risco de vazar dado alheio mesmo se este flag algum
      // dia ficar desatualizado). Hoje todo papel busca essa lista.
      const podeVerPapelaria = true;
      const [
        colaboradores, equipamentos, linhas, acessos, lotes,
        solicitacoes, chamados, movimentacoes, historico, solicitacoesPapelaria,
        unidades, setores, cargos, empresas, sistemas,
        categoriasEquipamento, marcasEquipamento, categoriasProdutoPapelaria, produtosPapelaria,
        categoriasProdutoEquipamento, produtosEquipamento, acessoriosEquipamento,
      ] = await Promise.all([
        colaboradoresApi.listAll(),
        equipamentosApi.listAll(),
        linhasApi.listAll(),
        acessosApi.listAll(),
        lotesApi.listAll(),
        solicitacoesApi.listAll(),
        chamadosApi.listAll(),
        podeVerMovimentacoes ? movimentacoesApi.listAll() : Promise.resolve([]),
        podeVerHistorico ? historicoApi.listAll() : Promise.resolve([]),
        podeVerPapelaria ? solicitacoesPapelariaApi.listAll() : Promise.resolve([]),
        dominiosApi.unidades(),
        dominiosApi.setores(),
        dominiosApi.cargos(),
        dominiosApi.empresas(),
        dominiosApi.sistemasAcesso(),
        dominiosApi.categoriasEquipamento(),
        dominiosApi.marcasEquipamento(),
        dominiosApi.categoriasProdutoPapelaria(),
        dominiosApi.produtosPapelaria(),
        dominiosApi.categoriasProdutoEquipamento(),
        dominiosApi.produtosEquipamento(),
        dominiosApi.acessoriosEquipamento(),
      ]);
      setData({
        colaboradores, equipamentos, linhas, acessos, lotes,
        solicitacoes, chamados, movimentacoes, historico, solicitacoesPapelaria,
        dominios: {
          unidades, setores, cargos, empresas, sistemas, categoriasEquipamento, marcasEquipamento,
          categoriasProdutoPapelaria, produtosPapelaria, categoriasProdutoEquipamento, produtosEquipamento,
          acessoriosEquipamento,
        },
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar dados do sistema.");
    } finally {
      setLoading(false);
    }
  }, [papel]);

  useEffect(() => {
    carregarTudo();
  }, [carregarTudo]);

  // Recarrega só um recurso (usado depois de criar/editar um registro,
  // evitando ter que buscar tudo de novo).
  //
  // Achado de auditoria (06/07/2026): antes, um erro aqui (ex: rede caiu bem
  // na hora do refetch, já depois da mutação ter sido salva com sucesso no
  // servidor) subia pro try/catch de quem chamou create/editar, que então
  // mostrava "Erro ao salvar" — uma mensagem falsa, já que o registro foi
  // criado/editado normalmente; só a lista local ficou desatualizada. Por
  // isso o try/catch fica aqui dentro: falha em refetch vira aviso no
  // console (não afeta o usuário) em vez de mascarar sucesso como erro.
  const refetch = useCallback(async (chave: ResourceKey) => {
    try {
      switch (chave) {
        case "colaboradores": return await colaboradoresApi.listAll().then((v) => setData((d) => ({ ...d, colaboradores: v })));
        case "equipamentos": return await equipamentosApi.listAll().then((v) => setData((d) => ({ ...d, equipamentos: v })));
        case "linhas": return await linhasApi.listAll().then((v) => setData((d) => ({ ...d, linhas: v })));
        case "acessos": return await acessosApi.listAll().then((v) => setData((d) => ({ ...d, acessos: v })));
        case "lotes": return await lotesApi.listAll().then((v) => setData((d) => ({ ...d, lotes: v })));
        case "solicitacoes": return await solicitacoesApi.listAll().then((v) => setData((d) => ({ ...d, solicitacoes: v })));
        case "chamados": return await chamadosApi.listAll().then((v) => setData((d) => ({ ...d, chamados: v })));
        case "movimentacoes": return await movimentacoesApi.listAll().then((v) => setData((d) => ({ ...d, movimentacoes: v })));
        case "historico": return await historicoApi.listAll().then((v) => setData((d) => ({ ...d, historico: v })));
        case "solicitacoesPapelaria": return await solicitacoesPapelariaApi.listAll().then((v) => setData((d) => ({ ...d, solicitacoesPapelaria: v })));
      }
    } catch (e) {
      console.warn(`Falha ao atualizar a lista "${chave}" após a última ação — o dado já salvo no servidor não foi afetado.`, e);
    }
  }, []);

  // Recarrega só as listas de domínio — usado pela página Configurações
  // depois de criar/renomear/ativar-inativar qualquer uma das 7 listas
  // mestras, sem precisar buscar o resto do sistema de novo. Mesmo racional
  // de try/catch interno do refetch acima.
  const refetchDominios = useCallback(async () => {
    try {
      const [
        unidades, setores, cargos, empresas, sistemas,
        categoriasEquipamento, marcasEquipamento, categoriasProdutoPapelaria, produtosPapelaria,
        categoriasProdutoEquipamento, produtosEquipamento, acessoriosEquipamento,
      ] = await Promise.all([
        dominiosApi.unidades(),
        dominiosApi.setores(),
        dominiosApi.cargos(),
        dominiosApi.empresas(),
        dominiosApi.sistemasAcesso(),
        dominiosApi.categoriasEquipamento(),
        dominiosApi.marcasEquipamento(),
        dominiosApi.categoriasProdutoPapelaria(),
        dominiosApi.produtosPapelaria(),
        dominiosApi.categoriasProdutoEquipamento(),
        dominiosApi.produtosEquipamento(),
        dominiosApi.acessoriosEquipamento(),
      ]);
      setData((d) => ({
        ...d,
        dominios: {
          unidades, setores, cargos, empresas, sistemas, categoriasEquipamento, marcasEquipamento,
          categoriasProdutoPapelaria, produtosPapelaria, categoriasProdutoEquipamento, produtosEquipamento,
          acessoriosEquipamento,
        },
      }));
    } catch (e) {
      console.warn("Falha ao atualizar as listas de domínio após a última ação — o dado já salvo no servidor não foi afetado.", e);
    }
  }, []);

  // "Tudo instantâneo" (09/07/2026, pedido do Vini) — ponte entre o evento
  // SSE "dados" (ver useNotificacoesStream.ts) e o `refetch` por recurso
  // que já existia. Um único lugar traduz `entidades: string[]` (nomes
  // soltos vindos do backend, ver avisarMudanca em utils/realtime.ts lá) —
  // "dominios" vira `refetchDominios()`, qualquer outro nome reconhecido
  // vira `refetch(chave)`; um nome desconhecido (ex: build do frontend
  // desatualizada em relação ao backend) é ignorado silenciosamente, nunca
  // quebra a tela. Quem chama (App.tsx/PortalColaborador.tsx) só precisa
  // repassar o evento cru pra <CentralNotificacoes onDados={...}>.
  const aplicarEventoDados = useCallback(
    (entidades: string[]) => {
      const tarefas = entidades.map((entidade) =>
        entidade === "dominios" ? refetchDominios() : refetch(entidade as ResourceKey)
      );
      return Promise.all(tarefas).then(() => {});
    },
    [refetch, refetchDominios]
  );

  return { data, loading, erro, refetch, refetchDominios, recarregarTudo: carregarTudo, aplicarEventoDados };
}
