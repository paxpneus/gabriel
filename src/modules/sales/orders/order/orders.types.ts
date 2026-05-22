import { customerAttributes } from "../../customers/customers.types"
import { orderItemsAttributes } from "../order_items/order_items.types";
export interface orderAttributes {
    id: string,
    integrations_id: string;
    customer_id: string;
    id_order_system?: string;
    number_order_system: string;
    number_order_channel: string;
    actual_step?: string;
    actual_situation?: string;
    collection_date?: Date;
    date?: Date;
    totalPrice?: number;
    nfe_emitted?: boolean;
    internal_status?: string;
    store_id?: string;
    waiting_acceptance?: boolean;
    source_system?: string;
    external_id?: string;
    external_number?: string;
    external_store_order_number?: string;
    external_status_id?: string;
    external_status_name?: string;
    external_invoice_id?: string;
    external_store_id?: string;
    external_unit_business_id?: string;
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
    
    createdAt?: Date,
    updatedAt?: Date,
}

export interface FullOrder extends orderAttributes {
    customer: customerAttributes,
    items: orderItemsAttributes[]
}

export type orderCreationAttributes = Omit<orderAttributes, 'id' | 'createdAt' | 'updateAt'>
