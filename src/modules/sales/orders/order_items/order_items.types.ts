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
    average_cost_snapshot?: number;
    total_cost_snapshot?: number;
    cost_source?: string;

    createdAt?: Date;
    updatedAt?: Date;
}

export type orderItemsCreationAttributes = Omit<orderItemsAttributes, 'id' | 'createdAt' | 'updatedAt'>
