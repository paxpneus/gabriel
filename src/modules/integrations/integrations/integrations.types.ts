export type integrationsType = 'CHANNEL' | 'SYSTEM'

export interface integrationsAttributes {
    id: string,
    name: string,
    type: integrationsType,
    api_url: string
}

export type integrationsCreationAttributes = Omit<integrationsAttributes, 'id'>