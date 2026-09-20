/**
 * 本地 JSON 文件存储模块
 * 替代 Supabase 存储开奖数据，无需任何外部凭据
 * 数据文件：data/lottery_draws.json（相对项目根目录）
 */
import fs from 'fs';
import path from 'path';
import type { DrawRecord } from '../../lib/lottery-engine';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'lottery_draws.json');

interface DrawStoreFile {
  version: number;
  draws: DrawRecord[];
}

// 进程内缓存，避免每次请求都读盘
let cache: DrawRecord[] | null = null;
// 写操作串行化，防止并发写坏文件
let writeQueue: Promise<unknown> = Promise.resolve();

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore(): { draws: DrawRecord[]; corrupted: boolean } {
  if (!fs.existsSync(DATA_FILE)) {
    return { draws: [], corrupted: false };
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DrawStoreFile;
    if (!parsed || !Array.isArray(parsed.draws)) {
      return { draws: [], corrupted: true };
    }
    return { draws: parsed.draws, corrupted: false };
  } catch (err) {
    console.error('[LocalStore] 读取本地数据文件失败:', err);
    return { draws: [], corrupted: true };
  }
}

function readFromDisk(): DrawRecord[] {
  const { draws, corrupted } = loadStore();
  if (corrupted) {
    // 显式失败而非返回空数组，防止 upsert 用少量新数据覆盖全部历史
    throw new Error(
      '本地数据文件 data/lottery_draws.json 已损坏，请从备份恢复或重新执行 scripts/seed-local-data.ts'
    );
  }
  return draws;
}

/**
 * 获取全部开奖数据（按期号升序，与历史接口行为一致）
 * 空缓存时重新读盘，保证外部脚本写入后能及时读到数据
 */
export function getAllDraws(): DrawRecord[] {
  if (!cache || cache.length === 0) {
    cache = readFromDisk();
  }
  return [...cache].sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * 按期号批量写入（已存在则跳过），返回插入/跳过数量
 */
export function upsertDraws(
  draws: Omit<DrawRecord, 'id'>[]
): Promise<{ inserted: number; skipped: number }> {
  writeQueue = writeQueue.then(() => {
    const existing = new Map<string, DrawRecord>();
    for (const d of getAllDraws()) {
      existing.set(d.period, d);
    }

    let inserted = 0;
    let skipped = 0;
    let maxId = 0;
    for (const d of existing.values()) {
      if (d.id > maxId) maxId = d.id;
    }

    for (const draw of draws) {
      if (existing.has(draw.period)) {
        skipped++;
        continue;
      }
      maxId += 1;
      existing.set(draw.period, { ...draw, id: maxId });
      inserted++;
    }

    const merged = Array.from(existing.values()).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    ensureDir();
    const tmpFile = `${DATA_FILE}.tmp`;
    const payload: DrawStoreFile = { version: 1, draws: merged };
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
    cache = merged;

    return { inserted, skipped };
  });
  return writeQueue as Promise<{ inserted: number; skipped: number }>;
}

/**
 * 获取最新期号，无数据时返回 null
 */
export function getLatestPeriod(): string | null {
  const all = getAllDraws();
  if (all.length === 0) return null;
  return all[all.length - 1].period;
}

/**
 * 清空缓存（外部修改文件后重新读取）
 */
export function invalidateCache(): void {
  cache = null;
}
