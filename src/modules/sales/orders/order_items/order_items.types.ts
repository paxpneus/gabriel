export interface orderItemsAttributes {
    id: string,
    name: string
    order_id: string;
    sku: string,
    unit: string,
    quantity: number,
    price: number,

    createdAt?: Date,
    updatedAt?: Date,
}

export type orderItemsCreationAttributes = Omit<orderItemsAttributes, 'id' | 'createdAt' | 'updatedAt'>