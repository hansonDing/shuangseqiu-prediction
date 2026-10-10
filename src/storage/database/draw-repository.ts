/**
 * 开奖数据访问层
 * 面向 StorageDriver 语义接口，不感知底层是 DuckDB 还是 CloudBase PG。
 * 读取走进程内缓存（开奖数据只增不改，缓存安全）。
 */
import type { DrawRecord } from '../../lib/lottery-engine';
import { getStorage } from './index';
import type { DrawRow } from './driver';

let cache: DrawRecord[] | null = null;
let loading: Promise<void> | null = null;

function toDrawRecord(r: DrawRow, id: number): DrawRecord {
  return {
    id,
    period: r.period,
    draw_date: r.draw_date,
    red1: r.red1,
    red2: r.red2,
    red3: r.red3,
    red4: r.red4,
    red5: r.red5,
    red6: r.red6,
    blue: r.blue,
  };
}

async function reload(): Promise<void> {
  const rows = await getStorage().listDraws();
  cache = rows.map((r, i) => toDrawRecord(r, i + 1));
}

export function ensureDrawsLoaded(): Promise<void> {
  if (cache) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      await getStorage().init();
      await reload();
    })();
  }
  return loading;
}

export function getAllDraws(): DrawRecord[] {
  if (!cache) throw new Error('开奖数据未加载，请先 await ensureDrawsLoaded()');
  return [...cache];
}

export function getLatestPeriod(): string | null {
  if (!cache || cache.length === 0) return null;
  return cache[cache.length - 1].period;
}

/** 已存在的期号由驱动按主键去重跳过，插入数由驱动返回 */
export function upsertDraws(
  draws: Omit<DrawRecord, 'id'>[]
): Promise<{ inserted: number; skipped: number }> {
  return getStorage().serialize(async () => {
    await ensureDrawsLoaded();
    const inserted = await getStorage().insertDraws(draws);
    if (inserted > 0) {
      await reload();
    }
    return { inserted, skipped: draws.length - inserted };
  });
}
