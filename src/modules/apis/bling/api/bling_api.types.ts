

// Retorno do token da bling
export interface BlingTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

 
// Fila dos processos de get de token, falhos e aceitos
export interface QueueItem {
  resolve: (token: string) => void
  reject: (error: unknown) => void
}