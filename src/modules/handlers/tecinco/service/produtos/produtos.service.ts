import { tcarRequest } from "../../api/tecinco_api";

export class TCarProdutoService {
  // ─── Produtos ──────────────────────────────────────────────────────────────

  /**
   * Lista produtos com filtros opcionais.
   * GET /produtos
   */
  async listarProdutos(
    branchId: number,
    params: {
      nome?: string;
      codigo?: string;
      grupo?: string;
      alterado_desde?: string;
      page?: number;
      page_size?: number;
    } = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/produtos", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um produto pelo código.
   * GET /produtos/:codigo
   */
  async obterProduto(branchId: number, codigo: string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/produtos/${encodeURIComponent(codigo)}`).then((r) => r.data),
    );
  }

  // ─── Serviços ──────────────────────────────────────────────────────────────

  /**
   * Lista serviços por marca/categoria (attma_id).
   * GET /servicos/:attma_id
   */
  async listarServicos(
    branchId: number,
    attmaId: string,
    params: { alterado_desde?: string; page?: number; page_size?: number } = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/servicos/${encodeURIComponent(attmaId)}`, { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um serviço por código simples (mantido por compatibilidade).
   * GET /servicos/:codigo
   */
  async obterServicoPorCodigo(branchId: number, codigo: string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/servicos/${encodeURIComponent(codigo)}`).then((r) => r.data),
    );
  }

  /**
   * Obtém um serviço pela chave composta attma_id + attpr_id.
   * GET /servicos/:attma_id/:attpr_id
   */
  async obterServico(branchId: number, attmaId: string, attprId: string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api
        .get(`/servicos/${encodeURIComponent(attmaId)}/${encodeURIComponent(attprId)}`)
        .then((r) => r.data),
    );
  }

  // ─── Estoque ───────────────────────────────────────────────────────────────

  /**
   * Consulta saldo de estoque de um produto.
   * GET /estoque/:produto_id
   */
  async consultarEstoque(branchId: number, produtoId: string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/estoque/${encodeURIComponent(produtoId)}`).then((r) => r.data),
    );
  }

  // ─── Preços ────────────────────────────────────────────────────────────────

  /**
   * Consulta preço de um produto.
   * GET /precos/produto/:produto_codigo
   */
  async consultarPrecoProduto(
    branchId: number,
    produtoCodigo: string,
    params: { cliente_codigo?: number | string; condicao_pagamento?: number | string } = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api
        .get(`/precos/produto/${encodeURIComponent(produtoCodigo)}`, { params })
        .then((r) => r.data),
    );
  }

  /**
   * Consulta preço de um serviço.
   * GET /precos/servico/:servico_codigo
   */
  async consultarPrecoServico(branchId: number, servicoCodigo: string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/precos/servico/${encodeURIComponent(servicoCodigo)}`).then((r) => r.data),
    );
  }
}

export default TCarProdutoService;