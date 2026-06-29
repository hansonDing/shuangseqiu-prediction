import { pgTable, serial, timestamp, integer, varchar, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const lotteryDraws = pgTable(
  "lottery_draws",
  {
    id: serial("id").primaryKey(),
    period: varchar("period", { length: 20 }).notNull().unique(),
    draw_date: varchar("draw_date", { length: 20 }).notNull(),
    red1: integer("red1").notNull(),
    red2: integer("red2").notNull(),
    red3: integer("red3").notNull(),
    red4: integer("red4").notNull(),
    red5: integer("red5").notNull(),
    red6: integer("red6").notNull(),
    blue: integer("blue").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lottery_draws_period_idx").on(table.period),
    index("lottery_draws_draw_date_idx").on(table.draw_date),
  ]
);

export type LotteryDraw = typeof lotteryDraws.$inferSelect;
