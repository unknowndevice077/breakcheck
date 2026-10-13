import axios, { AxiosRequestConfig, AxiosError } from 'axios'

export const api = axios.create({ baseURL: 'https://example.com', timeout: 5000 })

api.interceptors.request.use((config: AxiosRequestConfig) => {
  config.headers = { ...config.headers, 'X-App': 'bench' }
  return config
})

export async function getJson<T>(url: string): Promise<T> {
  try {
    const res = await api.get<T>(url)
    return res.data
  } catch (e) {
    const err = e as AxiosError
    if (err.response?.status === 404) throw new Error('not found')
    throw e
  }
}

export function isCancel(e: unknown): boolean {
  return axios.isCancel(e)
}

export const source = axios.CancelToken.source()
