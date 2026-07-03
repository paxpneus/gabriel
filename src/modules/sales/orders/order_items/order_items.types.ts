export interface orderItemsAttributes {
    id: string;
    order_id: string;
    name: string;
    sku: string;
    unit: string;
    quantity: number;
    price: number;
    product_id?: string;
    integrations_id?: string;
    source_payload?: Record<string, unknown>;
    unit_price?: number;
    gross_total?: number;
    discount_value?: number;
    net_total?: number;
    commission_base?: number;
    commission_rate?: number;
    comission_manager_rate?: number;
    commission_value?: number;
    average_cost_snapshot?: number | null;
    total_cost_snapshot?: number | null;
    cost_source?: string;

    createdAt?: Date;
    updatedAt?: Date;
}

export type orderItemsCreationAttributes = Omit<orderItemsAttributes, 'id' | 'createdAt' | 'updatedAt'>

export interface OrderSalesDetailRow {
  data_pedido: Date | string;
  numero_pedido: string | null;

  nome_unidade_negocio: string | null;
  numero_unidade_negocio: string | null;
  cnpj_unidade_negocio: string | null;

  nome_produto: string | null;
  ean_produto: string | null;
  sku: string | null;

  quantidade: number;

  nome_vendedor: string | null;

  nome_cliente: string | null;
  documento_cliente: string | null;

  valor_venda_item: number;
  valor_total_pedido: number;

  custo: number;
  custo_medio: number | null;
  valor_comissao: number | null;

  icms_rateado: number;
  taxa_marketplace_rateada: number;
  frete_rateado: number;
  valor_venda_rateado: number;

  lucro: number;

  numero_nota_fiscal: string | null;
}

export interface SalesDetailFilters {
  startDate?: string;
  endDate?: string;
  unitBusinessId?: string;
  sellerId?: string;
  productId?: string;
  orderId?: string;
  customerId?: string;
}