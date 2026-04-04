export interface storeAttributes {
    id: string;
    name: string;
    id_store_system: string;

    createdAt?: Date;
    updatedAt?: Date;
} 

export type storeCreationAttributes = Omit<storeAttributes, 'id' | 'createdAt' | 'updatedAt'>