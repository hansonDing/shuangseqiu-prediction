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
