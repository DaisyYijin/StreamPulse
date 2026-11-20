import { randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

export type QrProvider = '115' | '123';
export type QrDevice = 'web' | 'android' | 'ios' | 'tv' | 'wechatmini' | 'alipaymini';
export type QrStatus = 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';

export interface QrCredentials {
  cookie?: string;
  token?: string;
  username?: string;
}

export interface QrSessionView {
  id: string;
  provider: QrProvider;
  device: QrDevice;
  name: string;
  expiresAt: string;
  qrDataUrl: string;
  status: QrStatus;
  message: string;
  credentials?: QrCredentials;
}

interface QrSession extends QrSessionView {
  sourceId?: string;
  uid?: string;
  sign?: string;
  time?: string;
  loginuuid?: string;
  uniId?: string;
  cookie?: string;
  scanned?: boolean;
  credentialRequested?: boolean;
}

const sessions = new Map<string, QrSession>();
const TTL_MS = 5 * 60_000;

function cleanup(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (new Date(session.expiresAt).getTime() <= now && session.status !== 'confirmed') {
      sessions.delete(id);
    }
  }
}

function sessionId(): string {
  return randomBytes(18).toString('base64url');
}

async function qrImage(content: string): Promise<string> {
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
    color: { dark: '#071108', light: '#ffffff' },
  });
}

async function jsonFetch(url: string, init: RequestInit = {}, timeout = 20_000): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`扫码接口返回非 JSON（HTTP ${response.status}）`);
  }
}

async function start115(
  name: string,
  device: QrDevice,
  sourceId?: string,
): Promise<QrSession> {
  const response = await fetch('https://qrcodeapi.115.com/api/1.0/web/1.0/token', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => ({}))) as any;
  const cookie = response.headers
    .getSetCookie()
    .map((item) => item.split(';')[0])
    .join('; ');
  const data = payload?.data;
  if (!data?.uid || !data?.qrcode) {
    throw new Error(payload?.message || payload?.error || '115 二维码生成失败');
  }
  return {
    id: sessionId(),
    provider: '115',
    device,
    name,
    sourceId,
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    qrDataUrl: await qrImage(String(data.qrcode)),
    status: 'waiting',
    message: '等待 115 App 扫码',
    uid: String(data.uid),
    sign: String(data.sign || ''),
    time: String(data.time || ''),
    cookie,
  };
}

async function poll115(session: QrSession): Promise<QrSession> {
  const params = new URLSearchParams({
    uid: session.uid || '',
    time: session.time || '',
    sign: session.sign || '',
    _: String(Math.floor(Date.now() / 1000)),
  });
  let payload: any;
  try {
    payload = await jsonFetch(
      `https://qrcodeapi.115.com/get/status/?${params}`,
      {
        headers: {
          ...(session.cookie ? { cookie: session.cookie } : {}),
          Referer: 'https://115.com/',
        },
      },
      35_000,
    );
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      session.status = 'waiting';
      session.message = '等待 115 App 扫码';
      return session;
    }
    throw error;
  }
  const data = payload?.data;
  const status = Number(data?.status ?? -1);
  if (status === -2) {
    session.status = 'error';
    session.message = '扫码已取消';
    return session;
  }
  if (status === -1) {
    session.status = 'expired';
    session.message = '二维码已过期，请重新生成';
    return session;
  }
  if (status === 0) {
    session.status = 'waiting';
    session.message = '等待 115 App 扫码';
    return session;
  }
  if (status === 1) {
    session.status = 'scanned';
    session.message = '已扫码，请在手机上确认登录';
    return session;
  }
  if (status !== 2) {
    session.status = 'waiting';
    session.message = data?.msg || '等待确认';
    return session;
  }

  if (session.credentialRequested) return session;
  session.credentialRequested = true;
  const form = new URLSearchParams({ account: session.uid || '', app: session.device });
  const login = await jsonFetch(
    `https://passportapi.115.com/app/1.0/${session.device}/1.0/login/qrcode`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(session.cookie ? { cookie: session.cookie } : {}),
      },
      body: form.toString(),
    },
  );
  const credential = login?.data?.cookie || login?.data?.credential;
  if (!credential?.UID || !credential?.CID || !credential?.SEID) {
    session.status = 'error';
    session.message = login?.message || login?.error || '115 登录未返回凭据';
    return session;
  }
  session.status = 'confirmed';
  session.message = '115 登录成功';
  session.credentials = {
    cookie: `UID=${credential.UID}; CID=${credential.CID}; SEID=${credential.SEID}; KID=${credential.KID || ''}`,
    username: '',
  };
  return session;
}

function fingerprint(): string {
  return randomBytes(32).toString('hex');
}

function qrHeaders(loginuuid: string): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Content-Type': 'application/json',
    Origin: 'https://user.123pan.cn',
    Referer: 'https://user.123pan.cn/centerlogin',
    platform: 'web',
    'app-version': '132',
    loginuuid,
  };
}

async function start123(name: string, sourceId?: string): Promise<QrSession> {
  const loginuuid = fingerprint();
  const clientUni = randomUUID();
  const headers = qrHeaders(loginuuid);
  let cookie = '';
  try {
    const page = await fetch('https://user.123pan.cn/centerlogin', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    cookie = page.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  } catch {
    // QR generation can still work without the page cookie.
  }
  const payload = await jsonFetch(
    `https://login.123pan.com/api/user/qr-code/generate?uniID=${encodeURIComponent(clientUni)}`,
    { headers: { ...headers, ...(cookie ? { cookie } : {}) } },
  );
  const data = payload?.data;
  if (payload?.code !== 0 || !data?.uniID || !data?.url) {
    throw new Error(payload?.message || '123 云盘二维码生成失败');
  }
  const qrUrl = `${data.url}?uniID=${encodeURIComponent(data.uniID)}&env=production`;
  return {
    id: sessionId(),
    provider: '123',
    device: 'web',
    name,
    sourceId,
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    qrDataUrl: await qrImage(qrUrl),
    status: 'waiting',
    message: '使用 123 App 或微信扫码',
    loginuuid,
    uniId: String(data.uniID),
    cookie,
  };
}

async function poll123(session: QrSession): Promise<QrSession> {
  const headers = qrHeaders(session.loginuuid || '');
  if (session.cookie) headers.cookie = session.cookie;
  const params = new URLSearchParams({
    uniID: session.uniId || '',
    remember: 'true',
    gray: 'true',
  });
  const payload = await jsonFetch(`https://login.123pan.com/api/user/qr-code/result?${params}`, {
    headers,
  });
  const status = Number(payload?.data?.loginStatus ?? -1);
  if (status === 0) {
    session.status = 'waiting';
    session.message = '使用 123 App 或微信扫码';
    return session;
  }
  if (status === 1) {
    session.status = 'scanned';
    session.message = '已扫码，请在手机上确认登录';
    session.scanned = true;
  } else if (status === 2) {
    session.status = 'scanned';
    session.message = '已确认，正在获取登录令牌';
    session.scanned = true;
  } else if (status === 3 || status === 4) {
    session.status = 'expired';
    session.message = '二维码已过期，请重新生成';
    return session;
  }

  if (!session.scanned || session.credentialRequested) return session;
  session.credentialRequested = true;
  const wx = await jsonFetch('https://login.123pan.com/api/user/qr-code/wx_code', {
    method: 'POST',
    headers,
    body: JSON.stringify({ uniID: session.uniId }),
  });
  const code = wx?.data?.wxCode || wx?.data?.wechat_code;
  if (!code) {
    session.credentialRequested = false;
    return session;
  }
  const login = await jsonFetch('https://login.123pan.com/api/user/sign_in', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: 'web',
      wechat_code: code,
      type: 4,
      remember: true,
      gray: true,
    }),
  });
  const token = login?.data?.token || '';
  if (login?.code !== 0 && login?.code !== 200) {
    session.status = 'error';
    session.message = login?.message || '123 云盘扫码登录失败';
    return session;
  }
  if (!token) {
    session.status = 'error';
    session.message = '123 云盘登录成功但未返回令牌';
    return session;
  }
  session.status = 'confirmed';
  session.message = '123 云盘登录成功';
  session.credentials = { token, username: '', cookie: session.cookie };
  return session;
}

export async function startQrLogin(input: {
  provider: QrProvider;
  device?: QrDevice;
  name: string;
  sourceId?: string;
}): Promise<QrSessionView> {
  cleanup();
  const session =
    input.provider === '115'
      ? await start115(input.name, input.device || 'wechatmini', input.sourceId)
      : await start123(input.name, input.sourceId);
  sessions.set(session.id, session);
  const { uid, sign, time, loginuuid, uniId, cookie, sourceId: _sourceId, ...view } = session;
  return view;
}

export async function pollQrLogin(id: string): Promise<QrSessionView | null> {
  cleanup();
  const session = sessions.get(id);
  if (!session) return null;
  if (session.status === 'confirmed') {
    const { uid, sign, time, loginuuid, uniId, cookie, sourceId: _sourceId, ...view } = session;
    return view;
  }
  if (session.status === 'expired' || session.status === 'error') {
    const { uid, sign, time, loginuuid, uniId, cookie, sourceId: _sourceId, ...view } = session;
    return view;
  }
  try {
    await (session.provider === '115' ? poll115(session) : poll123(session));
  } catch (error) {
    session.status = 'error';
    session.message = error instanceof Error ? error.message : String(error);
  }
  const { uid, sign, time, loginuuid, uniId, cookie, sourceId: _sourceId, ...view } = session;
  return view;
}

export function takeQrSession(id: string): QrSession | undefined {
  const session = sessions.get(id);
  if (session) sessions.delete(id);
  return session;
}
