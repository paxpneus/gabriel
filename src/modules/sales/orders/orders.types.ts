import { customerAttributes } from "../customers/customers.types"

export interface orderAttributes {
    id: string,
    integration_id: string,
    customer_id: string,
    number_order_system: string,
    number_order_channel: string,
    actual_step?: string,
    actual_situation?: string,
}

export interface FullOrder extends orderAttributes {
    customer: customerAttributes
}

export type orderCreationAttributes = Omit<orderAttributes, 'id'>