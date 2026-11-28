// 统一 API 客户端:token 存 localStorage,401 自动回登录页。
const TOKEN_KEY = 'sp_token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request(path: string, opts: RequestInit = {}, auth = true): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(auth && getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
    ...(opts.headers as Record<string, string> || {}),
  }
  const res = await fetch(path, { ...opts, headers })
  const txt = await res.text()
  let data: any = null
  try { data = txt ? JSON.parse(txt) : null } catch { data = txt }
  if (res.status === 401 && auth) {
    clearToken()
    throw new ApiError('登录已过期，请重新登录', 'not_logged_in', 401)
  }
  if (!res.ok) {
    // 后端错误契约:{error: "文案", code: "机器码"}
    const msg = (data && data.error) || ('HTTP ' + res.status)
    const code = (data && data.code) || ''
    throw new ApiError(msg, code, res.status)
  }
  return data
}

export function publicJSON(path: string, opts?: RequestInit) {
  return request(path, opts, false)
}

export function api(path: string, opts?: RequestInit) {
  return request(path, opts, true)
}
