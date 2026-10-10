/**
 * PostgREST 请求构造（纯函数，可单测）
 *
 * CloudBase PostgreSQL 的服务端访问通道是 PostgREST 兼容的 HTTP API：
 *   表：  https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/<table>
 *   RPC： https://<envId>.api.tcloudbasegateway.com/v1/rdb/rest/rpc/<function>
 * 鉴权：Authorization: Bearer <API Key>（映射 service_role，绕过 RLS，只能放服务端）
 *
 * 这一层刻意只做字符串拼装，不碰网络，便于在没有密钥的环境下验证正确性。
 */

export const DEFAULT_GATEWAY_HOST = 'api.tcloudbasegateway.com';
export const REST_PATH = '/v1/rdb/rest';

export interface QueryOptions {
  /** 列白名单，如 'id,period'；省略返回全部列 */
  select?: string;
  /** PostgREST 过滤表达式，如 { status: 'eq.pending', run_id: 'eq.3' } */
  filters?: Record<string, string>;
  /** 排序，如 'period.asc' 或 'settled_at.desc,id.desc' */
  order?: string;
  limit?: number;
}

/** 网关基址：默认按 envId 推导，可用 CLOUDBASE_API_BASE 覆盖（内网/代理） */
export function restBaseUrl(envId: string, override?: string): string {
  const host = (override ?? '').trim().replace(/\/+$/, '');
  if (host) return host.endsWith(REST_PATH) ? host : `${host}${REST_PATH}`;
  return `https://${envId}.${DEFAULT_GATEWAY_HOST}${REST_PATH}`;
}

/** 构造表查询 URL；过滤项与排序按插入顺序稳定输出 */
export function buildTableUrl(
  base: string,
  table: string,
  opts: QueryOptions = {}
): string {
  const parts: string[] = [];
  if (opts.select) parts.push(`select=${encodeURIComponent(opts.select)}`);
  for (const [key, expr] of Object.entries(opts.filters ?? {})) {
    if (expr === undefined || expr === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(expr)}`);
  }
  if (opts.order) parts.push(`order=${encodeURIComponent(opts.order)}`);
  if (typeof opts.limit === 'number') parts.push(`limit=${opts.limit}`);
  const query = parts.length > 0 ? `?${parts.join('&')}` : '';
  return `${base}/${table}${query}`;
}

/** 构造 RPC URL */
export function buildRpcUrl(base: string, fn: string): string {
  return `${base}/rpc/${fn}`;
}

/** 构造 PostgREST 的 in.(...) 表达式 */
export function inExpr(values: (string | number)[]): string {
  return `in.(${values.join(',')})`;
}

/** 校验 PostgREST 响应体是数组，避免把错误对象当行列表用 */
export function toRows<T>(payload: unknown, context: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload === null || payload === undefined) return [];
  throw new Error(
    `[CloudBase] ${context} 期望数组响应，实际收到 ${typeof payload}`
  );
}

/** 校验 RPC 响应体是标量（函数返回 bigint / void 时） */
export function toScalar(payload: unknown): number | null {
  if (typeof payload === 'number') return payload;
  if (typeof payload === 'string' && payload.trim() !== '' && !Number.isNaN(Number(payload))) {
    return Number(payload);
  }
  return null;
}
