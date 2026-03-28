import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'

export interface AxiosInstanceOptions {
  baseURL: string
  timeout?: number
  headers?: Record<string, string>
  onRequest?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>
  onResponse?: (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>
  onRequestError?: (error: unknown) => unknown
  onResponseError?: (error: unknown) => unknown
}

export function createAxiosInstance({
  baseURL,
  timeout = 15_000,
  headers = {},
  onRequest,
  onResponse,
  onRequestError,
  onResponseError,
}: AxiosInstanceOptions): AxiosInstance {
  const instance = axios.create({
    baseURL,
    timeout,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    } satisfies AxiosRequestConfig['headers'],
  })

  instance.interceptors.request.use(
    (config) => (onRequest ? onRequest(config) : config),
    (error) => (onRequestError ? onRequestError(error) : Promise.reject(error)),
  )

  instance.interceptors.response.use(
    (response) => (onResponse ? onResponse(response) : response),
    (error) => (onResponseError ? onResponseError(error) : Promise.reject(error)),
  )

  return instance
}