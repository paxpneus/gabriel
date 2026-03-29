import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { createAxiosInstance } from '../../../../config/axios'
import integrationsService from '../../../integrations/integrations/integrations.service'
import { QueueItem, BlingTokenResponse } from './bling_api.types'
import ConfigToken from '../../../integrations/config_tokens/config_tokens.model'
import { FullIntegration } from '../../../integrations/integrations/integrations.types'
let isRefreshing = false
let failedQueue: QueueItem[] = []


// Fila em memória para lidar com os requests para a bling. Se caso uma falhar, não tenta enviar vários requests com o token expirado até fazer refresh, guarda todos requests numa fila, executa o refresh, pega o token novo e faz as requisições com o token novo, sem desperdiçar chamadas falhas para a bling
function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!),
  )
  failedQueue = []
}
 
// Busca a integração com a bling (options, chave redis para cache)
export const getBlingIntegration = async (cacheKey?: string): Promise<FullIntegration> => {
    const integration = await integrationsService.getFullIntegration({where: {
        name: 'Bling',
        type: 'SYSTEM',
        
    }}, 
    cacheKey ? 'Bling' : undefined
)

    if (!integration) throw new Error('Bling api não encontrada')

    return integration
}

// Pega o config Token da integração bling
const getBlingToken = async ():Promise<ConfigToken> =>  {
    const integration = await getBlingIntegration('Bling')

    const token = integration.tokens

    if (!token) throw new Error('BlingApi Nenhum configToken Encontrado')

        return token 
}

const doRefreshToken = async(): Promise<string> => {
  
  const integration = await getBlingIntegration()
 
  const configToken = integration.tokens
  if (!configToken) throw new Error('[BlingApi] ConfigToken não encontrado para refresh.')
 
  // Bling exige Basic Auth com clientId:clientSecret em Base64
  const basic = Buffer
    .from(`${configToken.client_id}:${configToken.client_secret}`)
    .toString('base64')
 
  const response = await fetch(configToken.access_token_url!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: configToken.refresh_token,
    }).toString(),
  })
 
  if (!response.ok) {
    throw new Error(`[BlingApi] Refresh token falhou: ${response.status} ${response.statusText}`)
  }
 
  const data = (await response.json()) as BlingTokenResponse;
 
  // Persiste os novos tokens no banco
  await configToken.update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
 
  return data.access_token
}

export const blingApi: AxiosInstance = createAxiosInstance({
  baseURL: 'https://www.bling.com.br/Api/v3',
 
  // Interceptor de request: injeta o token atual
  onRequest: async (config) => {
    const configToken = await getBlingToken()
    config.headers.Authorization = `Bearer ${configToken.access_token}`
    return config
  },
 
  // Interceptor de response: trata 401 com refresh automático
  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error)
 
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean }
 
    // rejeita sem tentar de novo se caso resposta for 401 ou já tentou refresh
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error)
    }
 
    originalRequest._retry = true
 
    // entra na fila e aguarda caso seja um refresh em andamento
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${token}`
        }
        return blingApi(originalRequest)
      })
    }
 
    isRefreshing = true
 
    try {
      const newToken = await doRefreshToken()
      processQueue(null, newToken)
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`
      }
      return blingApi(originalRequest) 
    } catch (refreshError) {
      processQueue(refreshError)
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
})

export const handleBlingOAuthCallback = async (code: string): Promise<void> => {
  const integration = await getBlingIntegration()
  const configToken = integration.tokens
  
  if (!configToken) throw new Error('ConfigToken não encontrado')

  const basic = Buffer
    .from(`${configToken.client_id}:${configToken.client_secret}`)
    .toString('base64')

    console.log({
  url: configToken.access_token_url,
  client_id: configToken.client_id,
  redirect_uri: configToken.callback_url,
  code,
})

  const tokenRes = await fetch(configToken.access_token_url!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: configToken.callback_url!,
    }).toString(),
  })

  if (!tokenRes.ok) {
  const errorBody = await tokenRes.text()
  console.log('Bling error body:', errorBody)
  throw new Error(`Erro ao trocar code: ${tokenRes.status}`)
}

  const { access_token, refresh_token } = await tokenRes.json() as BlingTokenResponse
await configToken.update({ access_token, refresh_token })

}