import { apiRequest } from "../lib/apiClient";
import {
  AcessorioEquipamento, CategoriaEquipamento, CategoriaProdutoEquipamento, CategoriaProdutoPapelaria, Cargo, Empresa,
  MarcaEquipamento, ProdutoEquipamento, ProdutoPapelaria, SistemaAcesso, Setor, Unidade, UnidadeMedidaProduto,
} from "../types";

// A partir da Evolução Completa (07/2026) estas listas deixaram de ser
// só-leitura: a página Configurações usa os métodos create/update abaixo
// para cadastrar e ativar/inativar cada uma, restrito a ADMINISTRADOR
// (o próprio backend recusa a chamada para qualquer outro papel).
export const dominiosApi = {
  unidades: () => apiRequest<Unidade[]>("/unidades"),
  criarUnidade: (nome: string) => apiRequest<Unidade>("/unidades", { method: "POST", body: { nome } }),
  atualizarUnidade: (id: string, data: Partial<Pick<Unidade, "nome" | "status">>) =>
    apiRequest<Unidade>(`/unidades/${id}`, { method: "PATCH", body: data }),
  removerUnidade: (id: string) => apiRequest<void>(`/unidades/${id}`, { method: "DELETE" }),

  setores: () => apiRequest<Setor[]>("/setores"),
  criarSetor: (nome: string) => apiRequest<Setor>("/setores", { method: "POST", body: { nome } }),
  atualizarSetor: (id: string, data: Partial<Pick<Setor, "nome" | "status">>) =>
    apiRequest<Setor>(`/setores/${id}`, { method: "PATCH", body: data }),
  removerSetor: (id: string) => apiRequest<void>(`/setores/${id}`, { method: "DELETE" }),

  cargos: (setorId?: string) => apiRequest<Cargo[]>("/cargos", { query: { setorId } }),
  criarCargo: (nome: string, setorId: string) => apiRequest<Cargo>("/cargos", { method: "POST", body: { nome, setorId } }),
  atualizarCargo: (id: string, data: Partial<Pick<Cargo, "nome" | "setorId">>) =>
    apiRequest<Cargo>(`/cargos/${id}`, { method: "PATCH", body: data }),
  removerCargo: (id: string) => apiRequest<void>(`/cargos/${id}`, { method: "DELETE" }),

  empresas: () => apiRequest<Empresa[]>("/empresas"),
  criarEmpresa: (data: { razaoSocial: string; cnpj?: string | null }) =>
    apiRequest<Empresa>("/empresas", { method: "POST", body: data }),
  atualizarEmpresa: (id: string, data: Partial<{ razaoSocial: string; cnpj: string | null }>) =>
    apiRequest<Empresa>(`/empresas/${id}`, { method: "PATCH", body: data }),
  removerEmpresa: (id: string) => apiRequest<void>(`/empresas/${id}`, { method: "DELETE" }),

  sistemasAcesso: () => apiRequest<SistemaAcesso[]>("/sistemas-acesso"),
  criarSistemaAcesso: (data: { nome: string; descricao?: string | null }) =>
    apiRequest<SistemaAcesso>("/sistemas-acesso", { method: "POST", body: data }),
  atualizarSistemaAcesso: (id: string, data: Partial<{ nome: string; descricao: string | null }>) =>
    apiRequest<SistemaAcesso>(`/sistemas-acesso/${id}`, { method: "PATCH", body: data }),
  removerSistemaAcesso: (id: string) => apiRequest<void>(`/sistemas-acesso/${id}`, { method: "DELETE" }),

  categoriasEquipamento: () => apiRequest<CategoriaEquipamento[]>("/categorias-equipamento"),
  criarCategoriaEquipamento: (nome: string) =>
    apiRequest<CategoriaEquipamento>("/categorias-equipamento", { method: "POST", body: { nome } }),
  atualizarCategoriaEquipamento: (id: string, data: Partial<Pick<CategoriaEquipamento, "nome" | "status">>) =>
    apiRequest<CategoriaEquipamento>(`/categorias-equipamento/${id}`, { method: "PATCH", body: data }),
  removerCategoriaEquipamento: (id: string) => apiRequest<void>(`/categorias-equipamento/${id}`, { method: "DELETE" }),

  marcasEquipamento: () => apiRequest<MarcaEquipamento[]>("/marcas-equipamento"),
  criarMarcaEquipamento: (nome: string) =>
    apiRequest<MarcaEquipamento>("/marcas-equipamento", { method: "POST", body: { nome } }),
  atualizarMarcaEquipamento: (id: string, data: Partial<Pick<MarcaEquipamento, "nome" | "status">>) =>
    apiRequest<MarcaEquipamento>(`/marcas-equipamento/${id}`, { method: "PATCH", body: data }),
  removerMarcaEquipamento: (id: string) => apiRequest<void>(`/marcas-equipamento/${id}`, { method: "DELETE" }),

  // Papelaria e Compras (09/07/2026) — mesmo padrão create/update/remove dos
  // domínios acima. categoriaId é obrigatória em ProdutoPapelaria (ON DELETE
  // RESTRICT no backend), diferente da FK opcional de Categoria/Marca de
  // Equipamento — por isso o backend recusa excluir uma categoria em uso.
  categoriasProdutoPapelaria: () => apiRequest<CategoriaProdutoPapelaria[]>("/categorias-produto-papelaria"),
  criarCategoriaProdutoPapelaria: (nome: string) =>
    apiRequest<CategoriaProdutoPapelaria>("/categorias-produto-papelaria", { method: "POST", body: { nome } }),
  atualizarCategoriaProdutoPapelaria: (id: string, data: Partial<Pick<CategoriaProdutoPapelaria, "nome" | "status">>) =>
    apiRequest<CategoriaProdutoPapelaria>(`/categorias-produto-papelaria/${id}`, { method: "PATCH", body: data }),
  removerCategoriaProdutoPapelaria: (id: string) => apiRequest<void>(`/categorias-produto-papelaria/${id}`, { method: "DELETE" }),

  produtosPapelaria: (categoriaId?: string) => apiRequest<ProdutoPapelaria[]>("/produtos-papelaria", { query: { categoriaId } }),
  criarProdutoPapelaria: (data: { nome: string; categoriaId: string; unidadeMedidaPadrao?: UnidadeMedidaProduto }) =>
    apiRequest<ProdutoPapelaria>("/produtos-papelaria", { method: "POST", body: data }),
  atualizarProdutoPapelaria: (
    id: string,
    data: Partial<{ nome: string; categoriaId: string; unidadeMedidaPadrao: UnidadeMedidaProduto; status: "ATIVO" | "INATIVO" }>
  ) => apiRequest<ProdutoPapelaria>(`/produtos-papelaria/${id}`, { method: "PATCH", body: data }),
  removerProdutoPapelaria: (id: string) => apiRequest<void>(`/produtos-papelaria/${id}`, { method: "DELETE" }),

  // Solicitação de Equipamentos (09/07/2026, "Ajuste na Estrutura das
  // Solicitações") — mesmo padrão create/update/remove de Papelaria acima.
  // Diferente de Papelaria: excluir uma categoria de equipamento só é
  // bloqueada por produtos do catálogo ainda vinculados a ela, nunca por
  // solicitações já feitas (produtoId/categoriaId lá são ON DELETE SET NULL
  // — ver comentário no backend).
  categoriasProdutoEquipamento: () => apiRequest<CategoriaProdutoEquipamento[]>("/categorias-produto-equipamento"),
  criarCategoriaProdutoEquipamento: (nome: string) =>
    apiRequest<CategoriaProdutoEquipamento>("/categorias-produto-equipamento", { method: "POST", body: { nome } }),
  atualizarCategoriaProdutoEquipamento: (id: string, data: Partial<Pick<CategoriaProdutoEquipamento, "nome" | "status">>) =>
    apiRequest<CategoriaProdutoEquipamento>(`/categorias-produto-equipamento/${id}`, { method: "PATCH", body: data }),
  removerCategoriaProdutoEquipamento: (id: string) => apiRequest<void>(`/categorias-produto-equipamento/${id}`, { method: "DELETE" }),

  produtosEquipamento: (categoriaId?: string) => apiRequest<ProdutoEquipamento[]>("/produtos-equipamento", { query: { categoriaId } }),
  criarProdutoEquipamento: (data: { nome: string; categoriaId: string }) =>
    apiRequest<ProdutoEquipamento>("/produtos-equipamento", { method: "POST", body: data }),
  atualizarProdutoEquipamento: (id: string, data: Partial<{ nome: string; categoriaId: string; status: "ATIVO" | "INATIVO" }>) =>
    apiRequest<ProdutoEquipamento>(`/produtos-equipamento/${id}`, { method: "PATCH", body: data }),
  removerProdutoEquipamento: (id: string) => apiRequest<void>(`/produtos-equipamento/${id}`, { method: "DELETE" }),

  // Acessórios de Equipamento (17/07/2026, "Acessórios e Foto do
  // Equipamento") — mesmo padrão create/update/remove acima. nome é único
  // por categoria (não globalmente), então "Carregador" pode existir tanto
  // em Notebook quanto em Celular como cadastros independentes.
  acessoriosEquipamento: (categoriaId?: string) =>
    apiRequest<AcessorioEquipamento[]>("/acessorios-equipamento", { query: { categoriaId } }),
  criarAcessorioEquipamento: (data: { nome: string; categoriaId: string }) =>
    apiRequest<AcessorioEquipamento>("/acessorios-equipamento", { method: "POST", body: data }),
  atualizarAcessorioEquipamento: (id: string, data: Partial<{ nome: string; categoriaId: string; status: "ATIVO" | "INATIVO" }>) =>
    apiRequest<AcessorioEquipamento>(`/acessorios-equipamento/${id}`, { method: "PATCH", body: data }),
  removerAcessorioEquipamento: (id: string) => apiRequest<void>(`/acessorios-equipamento/${id}`, { method: "DELETE" }),
};
