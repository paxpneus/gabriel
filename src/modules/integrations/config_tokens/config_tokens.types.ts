export interface configTokensAtributes {
    id: string,
    integrations_id: string,
    access_token?: string,
    refresh_token?: string,
    client_id: string,
    client_secret: string,
    access_token_url: string,
    auth_url: string,
    callback_url: string,
    oauth_state?: string,
}

export type configTokensCreationAtributes = Omit<configTokensAtributes, 'id'>