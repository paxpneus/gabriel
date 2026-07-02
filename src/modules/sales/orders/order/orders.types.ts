import { customerAttributes } from "../../customers/customers.types"
import { orderItemsAttributes } from "../order_items/order_items.types";

export interface orderAttributes {
    id: string;
    integrations_id: string;
    customer_id: string;
    seller_id?: string;
    id_order_system?: string;
    number_order_system: string;
    number_order_channel: string;
    actual_step?: string;
    actual_situation?: string;
    collection_date?: Date;
    date?: Date;
    total_price?: number;
    total_cost?: number;
    nfe_emitted?: boolean;
    internal_status?: string;
    store_id?: string | null;
    unit_business_id?: string | null;
    invoice_id?: string | null;
    waiting_acceptance?: boolean;
    source_payload?: Record<string, unknown>;
    total_products?: number;
    total_order?: number;
    discount_value?: number;
    discount_type?: string;
    other_expenses?: number;
    freight_charged?: number;
    freight_cost?: number;
    freight_by_account?: number;
    gross_weight?: number;
    tax_commission?: number;
    tax_base_value?: number;
    marketplace_fee?: number;
    payment_fee?: number;

    // Campos fiscais/geográficos vindos do ERP (ex: endereço do contato na Bling)
    destination_uf?: string;
    destination_city?: string;
    icms_value?: number;
    ipi_value?: number;
    pis_value?: number;
    cofins_value?: number;
    difal_value?: number;
    ibs_value?: number;
    cbs_value?: number;
    approx_tax_value?: number;

    createdAt?: Date;
    updatedAt?: Date;
}

export interface FullOrder extends orderAttributes {
    customer: customerAttributes;
    items: orderItemsAttributes[];
}

export type orderCreationAttributes = Omit<orderAttributes, 'id' | 'createdAt' | 'updatedAt'>