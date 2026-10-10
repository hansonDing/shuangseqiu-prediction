/**
 * 存储驱动选择入口
 *
 * STORAGE_DRIVER 环境变量：
 *   duckdb（默认）—— 文件型数据库，本地开发与自建服务器使用
 *   cloudbase      —— 腾讯云 CloudBase PostgreSQL，云托管使用
 */
import { duckdbDriver } from './duckdb-driver';
import { cloudbaseDriver } from './cloudbase-driver';
import type { StorageDriver } from './driver';

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const kind = (process.env.STORAGE_DRIVER ?? 'duckdb').trim().toLowerCase();
  if (kind === 'cloudbase') {
    cached = cloudbaseDriver;
  } else {
    if (kind !== 'duckdb' && kind !== '') {
      console.warn(
        `[Storage] 未知的 STORAGE_DRIVER="${kind}"，已回退到 duckdb`
      );
    }
    cached = duckdbDriver;
  }
  return cached;
}

export type { StorageDriver };
