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
  pedido: {
    data_atualizacao: Date | string | null;
    data_pedido: Date | string;
    numero_pedido: string | null;
    valor_total_pedido: number;
    custo_total_pedido: number;
    numero_nota_fiscal: string | null;
  };

  vendedor: {
    id_vendedor_tecinco: string;
    nome_vendedor: string | null;
  };

  loja: {
    id_loja_tecinco: number | null;
    nome_loja: string | null;
    numero_loja: string | null;
    cnpj_loja: string | null;
  };

  produto: {
    identificacao: {
      nome: string | null;
      ean: string | null;
      sku_tecinco: string | null;
      sku_bling: string | null;
      linha: string | null;
    };

    medida: {
      completa: string | null;
      largura: number | null;
      perfil: number | null;
      aro: number | null;
    };

    precos: {
      quantidade: number;
      valor_venda_item: number;
      custo_medio: number | null;
      custo_total_item_pedido: number;
      valor_premiacao_vendedor_item_pedido: number | null;
    };

    marca: {
      nome: string | null;
      premiacao_vendedor_pct: number | null;
      premiacao_gerente_pct: number | null;
    };
  };

  cliente: {
    nome_cliente: string | null;
    documento_cliente: string | null;
  };
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