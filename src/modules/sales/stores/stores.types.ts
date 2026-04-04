export interface storeAttributes {
    id: string;
    name: string;

    createdAt?: Date;
    updatedAt?: Date;
} 

export type storeCreationAttributes = Omit<storeAttributes, 'id' | 'createdAt' | 'updatedAt'>