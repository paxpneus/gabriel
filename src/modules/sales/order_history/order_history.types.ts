import { Json } from "sequelize/types/utils";

export type resultTypes = 'success' | 'errors' | 'processing'

export interface orderHistoryAttributes {
    id: string,
    step_id: string,
    order_id: string,
    situation: string,
    date: Date,
    json_data: Json
    result: resultTypes
}

export type orderHistoryCreationAttributes = Omit<orderHistoryAttributes, 'id'>