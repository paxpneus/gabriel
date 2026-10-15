export type userType = 'F' | 'J'

export interface customerAttributes {
    id: string,
    name: string,
    type: userType,
    document: string | null
}

export type customerCreationAttributes = Omit<customerAttributes, 'id'>