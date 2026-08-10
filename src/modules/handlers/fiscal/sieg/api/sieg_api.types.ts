// Retorno do endpoint de autenticação da Sieg (gera o JWT a partir da ApiKey)
// Ajuste os nomes dos campos conforme o payload real retornado pela Sieg.
export interface SiegTokenResponse {
  jwt: string;
  // A Sieg pode não retornar expires_in explicitamente — nesse caso o
  // controle de expiração é feito decodificando o próprio JWT (claim "exp").
  expires_in?: number;
}

// Fila dos processos de get de token, falhos e aceitos
export interface QueueItem {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}