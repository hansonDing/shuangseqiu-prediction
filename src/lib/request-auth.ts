/**
 * 更新/买入/重置等写接口的触发鉴权：
 * 1. 配置了 UPDATE_TOKEN 环境变量时，必须携带 `Authorization: Bearer <token>`
 * 2. 未配置 token 时，仅允许回环地址（127.0.0.1 / ::1 / localhost）触发
 * 注意：Next.js 会自动填充 x-forwarded-for（值为对端 IP），必须解析其 IP 判断回环
 */
export function isLoopback(ip: string): boolean {
  return ip === 'localhost'
    || ip.startsWith('127.')
    || ip === '::1'
    || ip === '0:0:0:0:0:0:0:1'
    || ip.startsWith('::ffff:127.')
    || ip.startsWith('::ffff:7f00:');
}

/**
 * 站内同源判定，用于「面向浏览器页面」的接口。
 *
 * 背景：写接口用 Bearer token 鉴权，但浏览器里的按钮不可能安全地持有令牌，
 * 因此站内 UI 走单独的通道，用「同源」而不是「共享密钥」来限定调用方。
 *
 * 判定口径（按优先级）：
 * 1. `Sec-Fetch-Site` —— 浏览器自动生成、页面脚本无法伪造，也不受反代改写 Host 影响。
 *    为 `same-origin` 才放行；`cross-site` / `same-site` 一律拒绝。
 * 2. 请求不带 Origin / Referer（curl、平台定时触发器等非浏览器调用）→ 放行，
 *    这类调用方本就无法靠 Origin 约束，交由其它手段（token、单飞、冷却）兜住。
 * 3. 带了 Origin / Referer 则必须与请求自身的 Host 一致，否则视为跨站调用予以拒绝。
 *
 * 兼容反代：Host 可能被改成内部地址，故同时接受 x-forwarded-host 与 request.url。
 */
export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin';

  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return true;

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    return false;
  }
  if (!sourceHost) return false;

  const candidates: string[] = [];
  for (const name of ['x-forwarded-host', 'host'] as const) {
    const value = request.headers.get(name);
    if (value) candidates.push(value.split(',')[0].trim());
  }
  try {
    candidates.push(new URL(request.url).host);
  } catch {
    // request.url 不可解析时忽略该项
  }

  return candidates.some((host) => host === sourceHost);
}

export function isAuthorized(request: Request): boolean {
  const token = process.env.UPDATE_TOKEN;
  if (token) {
    return request.headers.get('authorization') === `Bearer ${token}`;
  }
  const forwarded = request.headers.get('x-forwarded-for');
  const peer = (forwarded ? forwarded.split(',')[0].trim() : null)
    ?? request.headers.get('x-real-ip');
  if (peer) {
    return isLoopback(peer);
  }
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}
