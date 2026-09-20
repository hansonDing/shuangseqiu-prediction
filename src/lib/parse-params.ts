/**
 * API 查询参数解析工具
 * 所有解析失败/越界的输入都回退到默认值，避免 NaN 污染计算链
 */

/** 解析 0~1 之间的权重参数，非法输入回退默认值 */
export function parseWeight(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

/** 解析正整数参数并钳制上限，非法输入回退默认值 */
export function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return Math.min(fallback, max);
  const v = Number(raw);
  if (!Number.isFinite(v)) return Math.min(fallback, max);
  return Math.min(Math.max(Math.trunc(v), 1), max);
}
