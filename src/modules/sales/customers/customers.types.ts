export type userType = 'P' | 'J'

export interface customerAttributes {
    id: string,
    name: string,
    type: userType,
    document: number
}

export type customerCreationAttributes = Omit<customerAttributes, 'id'>