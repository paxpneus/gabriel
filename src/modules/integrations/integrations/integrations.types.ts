import ConfigToken from '../config_tokens/config_tokens.model';
import { configTokensAtributes } from './../config_tokens/config_tokens.types';
import Integration from './integrations.model';
export type integrationsType = 'CHANNEL' | 'SYSTEM'

export interface integrationsAttributes {
    id: string,
    name: string,
    type: integrationsType,
    api_url: string
}

export type integrationsCreationAttributes = Omit<integrationsAttributes, 'id'>

export interface FullIntegration extends Integration {
  tokens: ConfigToken[]
}