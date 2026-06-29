import { getSupabaseClient } from '../src/storage/database/supabase-client';

function generateDraw(periodNum: number): {
  period: string;
  draw_date: string;
  red1: number; red2: number; red3: number;
  red4: number; red5: number; red6: number;
  blue: number;
} {
  const reds: number[] = [];
  while (reds.length < 6) {
    const r = 1 + Math.floor(Math.random() * 33);
    if (!reds.includes(r)) reds.push(r);
  }
  reds.sort((a, b) => a - b);

  const baseDate = new Date('2024-01-02');
  baseDate.setDate(baseDate.getDate() + (periodNum - 1) * 3);
  const dateStr = baseDate.toISOString().split('T')[0];

  return {
    period: `2024${String(periodNum).padStart(3, '0')}`,
    draw_date: dateStr,
    red1: reds[0], red2: reds[1], red3: reds[2],
    red4: reds[3], red5: reds[4], red6: reds[5],
    blue: 1 + Math.floor(Math.random() * 16),
  };
}

async function seed() {
  const client = getSupabaseClient();

  // Delete existing data
  const { error: delError } = await client.from('lottery_draws').delete().gte('id', 0);
  if (delError) {
    console.error('Delete failed:', delError);
    process.exit(1);
  }

  const draws = [];
  for (let i = 1; i <= 150; i++) {
    draws.push(generateDraw(i));
  }

  // Insert in batches of 50
  for (let i = 0; i < draws.length; i += 50) {
    const batch = draws.slice(i, i + 50);
    const { error } = await client.from('lottery_draws').insert(batch);
    if (error) {
      console.error(`Batch insert failed at ${i}:`, error);
      process.exit(1);
    }
  }

  console.log(`Seeded ${draws.length} lottery draws successfully`);
}

seed();
