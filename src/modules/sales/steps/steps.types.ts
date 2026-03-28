export interface stepAttributes {
    id: string,
    label_admin: string,
    label_system: string,
    sequence: number,
}

export type stepCreationAttributes = Omit<stepAttributes, 'id'>