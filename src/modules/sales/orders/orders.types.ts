import { customerAttributes } from "../customers/customers.types"

export interface orderAttributes {
    id: string,
    integration_id: string,
    customer_id: string,
    id_order_system?: string,
    number_order_system: string,
    number_order_channel: string,
    actual_step?: string,
    actual_situation?: string,
    collection_date?: Date,
    date?: Date,
    totalPrice?: number,
    createdAt?: Date,
}

export interface FullOrder extends orderAttributes {
    customer: customerAttributes
}

export type orderCreationAttributes = Omit<orderAttributes, 'id' | 'createdAt'>