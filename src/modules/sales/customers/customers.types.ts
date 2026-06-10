export type userType = 'F' | 'J'

export interface customerAttributes {
    id: string,
    name: string,
    type: userType,
    document: string
}

export type customerCreationAttributes = Omit<customerAttributes, 'id'>