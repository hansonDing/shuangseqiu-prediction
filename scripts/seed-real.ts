/**
 * 插入真实双色球开奖数据 (来源：中彩网 zhcw.com)
 * 用于替换模拟数据
 */
import { getSupabaseClient } from '../src/storage/database/supabase-client';

// 真实开奖数据 (2026044 - 2026073，来源：中彩网)
const realDraws = [
  { period: '2026073', draw_date: '2026-06-28', red1: 9, red2: 10, red3: 13, red4: 16, red5: 19, red6: 21, blue: 8 },
  { period: '2026072', draw_date: '2026-06-25', red1: 7, red2: 8, red3: 12, red4: 15, red5: 17, red6: 21, blue: 1 },
  { period: '2026071', draw_date: '2026-06-23', red1: 3, red2: 8, red3: 19, red4: 25, red5: 31, red6: 33, blue: 5 },
  { period: '2026070', draw_date: '2026-06-21', red1: 3, red2: 6, red3: 8, red4: 14, red5: 26, red6: 27, blue: 8 },
  { period: '2026069', draw_date: '2026-06-18', red1: 12, red2: 14, red3: 16, red4: 17, red5: 18, red6: 32, blue: 8 },
  { period: '2026068', draw_date: '2026-06-16', red1: 3, red2: 5, red3: 16, red4: 18, red5: 29, red6: 32, blue: 4 },
  { period: '2026067', draw_date: '2026-06-14', red1: 4, red2: 19, red3: 27, red4: 29, red5: 30, red6: 32, blue: 13 },
  { period: '2026066', draw_date: '2026-06-11', red1: 5, red2: 11, red3: 21, red4: 23, red5: 24, red6: 29, blue: 16 },
  { period: '2026065', draw_date: '2026-06-09', red1: 7, red2: 8, red3: 16, red4: 24, red5: 30, red6: 32, blue: 2 },
  { period: '2026064', draw_date: '2026-06-07', red1: 1, red2: 9, red3: 15, red4: 18, red5: 29, red6: 33, blue: 15 },
  { period: '2026063', draw_date: '2026-06-04', red1: 2, red2: 8, red3: 25, red4: 28, red5: 30, red6: 31, blue: 2 },
  { period: '2026062', draw_date: '2026-06-02', red1: 2, red2: 4, red3: 7, red4: 14, red5: 28, red6: 29, blue: 9 },
  { period: '2026061', draw_date: '2026-05-31', red1: 1, red2: 4, red3: 5, red4: 15, red5: 23, red6: 28, blue: 7 },
  { period: '2026060', draw_date: '2026-05-28', red1: 7, red2: 9, red3: 10, red4: 16, red5: 22, red6: 27, blue: 11 },
  { period: '2026059', draw_date: '2026-05-26', red1: 8, red2: 16, red3: 26, red4: 28, red5: 29, red6: 30, blue: 15 },
  { period: '2026058', draw_date: '2026-05-24', red1: 1, red2: 4, red3: 7, red4: 21, red5: 29, red6: 30, blue: 1 },
  { period: '2026057', draw_date: '2026-05-21', red1: 1, red2: 10, red3: 22, red4: 24, red5: 28, red6: 30, blue: 7 },
  { period: '2026056', draw_date: '2026-05-19', red1: 10, red2: 19, red3: 21, red4: 22, red5: 31, red6: 33, blue: 5 },
  { period: '2026055', draw_date: '2026-05-17', red1: 4, red2: 11, red3: 24, red4: 25, red5: 32, red6: 33, blue: 13 },
  { period: '2026054', draw_date: '2026-05-14', red1: 13, red2: 20, red3: 25, red4: 29, red5: 30, red6: 33, blue: 2 },
  { period: '2026053', draw_date: '2026-05-12', red1: 1, red2: 2, red3: 3, red4: 8, red5: 13, red6: 14, blue: 2 },
  { period: '2026052', draw_date: '2026-05-10', red1: 1, red2: 3, red3: 11, red4: 22, red5: 26, red6: 31, blue: 11 },
  { period: '2026051', draw_date: '2026-05-07', red1: 9, red2: 14, red3: 15, red4: 16, red5: 29, red6: 30, blue: 10 },
  { period: '2026050', draw_date: '2026-05-05', red1: 6, red2: 9, red3: 25, red4: 27, red5: 28, red6: 30, blue: 3 },
  { period: '2026049', draw_date: '2026-05-03', red1: 3, red2: 4, red3: 14, red4: 15, red5: 18, red6: 20, blue: 2 },
  { period: '2026048', draw_date: '2026-04-30', red1: 9, red2: 15, red3: 18, red4: 24, red5: 28, red6: 33, blue: 1 },
  { period: '2026047', draw_date: '2026-04-28', red1: 7, red2: 16, red3: 21, red4: 24, red5: 27, red6: 30, blue: 7 },
  { period: '2026046', draw_date: '2026-04-26', red1: 2, red2: 9, red3: 10, red4: 24, red5: 31, red6: 33, blue: 16 },
  { period: '2026045', draw_date: '2026-04-23', red1: 4, red2: 11, red3: 15, red4: 17, red5: 24, red6: 30, blue: 15 },
  { period: '2026044', draw_date: '2026-04-21', red1: 2, red2: 14, red3: 17, red4: 18, red5: 22, red6: 30, blue: 1 },
];

async function seedReal() {
  const client = getSupabaseClient();

  // 清除旧数据
  const { error: delError } = await client.from('lottery_draws').delete().gte('id', 0);
  if (delError) {
    console.error('清除旧数据失败:', delError.message);
    process.exit(1);
  }

  // 插入真实数据
  const { error: insertError } = await client.from('lottery_draws').insert(realDraws);
  if (insertError) {
    console.error('插入数据失败:', insertError.message);
    process.exit(1);
  }

  console.log(`成功插入 ${realDraws.length} 期真实开奖数据 (${realDraws[realDraws.length - 1].period} ~ ${realDraws[0].period})`);
}

seedReal();
