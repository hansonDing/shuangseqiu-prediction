/**
 * 开奖数据访问层（DuckDB 实现）
 * 对上层暴露的接口与旧 local-store 保持一致，读取走进程内缓存
 */
import type { DrawRecord } from '../../lib/lottery-engine';
import { initDatabase, all, run, serialize } from './duckdb';

let cache: DrawRecord[] | null = null;
let loading: Promise<void> | null = null;

type DrawRow = {
  period: string; draw_date: string;
  red1: number; red2: number; red3: number;
  red4: number; red5: number; red6: number;
  blue: number;
};

const SELECT_COLS =
  'period, draw_date, red1, red2, red3, red4, red5, red6, blue FROM draws ORDER BY period';

function toDrawRecord(r: DrawRow, id: number): DrawRecord {
  return {
    id,
    period: r.period,
    draw_date: r.draw_date,
    red1: r.red1, red2: r.red2, red3: r.red3,
    red4: r.red4, red5: r.red5, red6: r.red6,
    blue: r.blue,
  };
}

export function ensureDrawsLoaded(): Promise<void> {
  if (cache) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      await initDatabase();
      const rows = await all<DrawRow>(`SELECT ${SELECT_COLS}`);
      cache = rows.map((r, i) => toDrawRecord(r, i + 1));
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

export function upsertDraws(
  draws: Omit<DrawRecord, 'id'>[]
): Promise<{ inserted: number; skipped: number }> {
  return serialize(async () => {
    await ensureDrawsLoaded();
    const existing = new Set((cache ?? []).map((d) => d.period));
    let inserted = 0;
    let skipped = 0;
    for (const d of draws) {
      if (existing.has(d.period)) {
        skipped++;
        continue;
      }
      await run(
        `INSERT INTO draws (period, draw_date, red1, red2, red3, red4, red5, red6, blue)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.period, d.draw_date,
        d.red1, d.red2, d.red3, d.red4, d.red5, d.red6, d.blue
      );
      inserted++;
    }
    if (inserted > 0) {
      const rows = await all<DrawRow>(`SELECT ${SELECT_COLS}`);
      cache = rows.map((r, i) => toDrawRecord(r, i + 1));
    }
    return { inserted, skipped };
  });
}
