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
    
    createdAt?: Date,
    updatedAt?: Date,
}

export interface FullOrder extends orderAttributes {
    customer: customerAttributes,
    items: orderItemsAttributes[]
}

export type orderCreationAttributes = Omit<orderAttributes, 'id' | 'createdAt' | 'updateAt'>