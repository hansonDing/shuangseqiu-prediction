-- 双色球预测 · 事务性写入函数（CloudBase PostgreSQL）
--
-- 为什么需要这些函数：
--   服务端经 PostgREST 访问数据库，而 PostgREST 是「一次一表」的无状态 HTTP 接口，
--   跨请求没有事务边界。买入 / 结算 / 重置都是多步写入，必须原子完成，
--   否则中途失败会留下「注单写了但没扣款」这类脏状态。
--   把事务性下沉为数据库函数后，一次 RPC 调用即一个事务。
--
-- 入参统一为一个 jsonb（p_payload），与 PostgREST 的 rpc 调用约定对齐：
--   POST /v1/rdb/rest/rpc/lottery_commit_buy   body: {"p_payload": {...}}
--
-- 业务计算（走势预测、中奖判定）仍留在 JS 侧，函数只负责持久化与一致性。

CREATE OR REPLACE FUNCTION lottery_commit_buy(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_period     text             := p_payload->>'period';
  v_bet_cost   double precision := COALESCE((p_payload->>'betCost')::double precision, 2);
  v_total_cost double precision := COALESCE((p_payload->>'totalCost')::double precision, 0);
  v_pending    text;
  v_run_id     bigint;
  v_cash       double precision;
  v_combo      jsonb;
BEGIN
  SELECT b.period INTO v_pending
    FROM lottery_bets b
   WHERE b.status = 'pending'
   LIMIT 1;
  IF v_pending IS NOT NULL THEN
    RAISE EXCEPTION '已有未结算持仓（目标期 %），拒绝重复买入', v_pending;
  END IF;

  INSERT INTO lottery_prediction_runs (period, weights, combos, prize_first, prize_second)
  VALUES (
    v_period,
    p_payload->>'weights',
    p_payload->>'combos',
    (p_payload->>'prizeFirst')::double precision,
    (p_payload->>'prizeSecond')::double precision
  )
  RETURNING id INTO v_run_id;

  FOR v_combo IN SELECT jsonb_array_elements(p_payload->'combos')
  LOOP
    INSERT INTO lottery_bets (run_id, period, reds, blue, cost)
    VALUES (
      v_run_id,
      v_period,
      (v_combo->'reds')::text,
      (v_combo->>'blue')::smallint,
      v_bet_cost
    );
  END LOOP;

  UPDATE lottery_account
     SET cash           = cash - v_total_cost,
         total_invested = total_invested + v_total_cost,
         updated_at     = now()
   WHERE id = 1;

  SELECT cash INTO v_cash FROM lottery_account WHERE id = 1;

  INSERT INTO lottery_fund_transactions (type, amount, balance_after, ref_id, note)
  VALUES ('buy', -v_total_cost, v_cash, v_run_id, p_payload->>'txnNote');

  INSERT INTO lottery_operation_log (type, message, detail)
  VALUES (
    'buy',
    p_payload->>'logMessage',
    jsonb_build_object('runId', v_run_id, 'cost', v_total_cost)::text
  );

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION lottery_commit_settlement(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_period      text             := p_payload->>'period';
  v_prize_total double precision := COALESCE((p_payload->>'periodPrize')::double precision, 0);
  v_result      jsonb;
  v_bet_id      bigint;
  v_prize       double precision;
  v_settle_id   bigint;
  v_cash        double precision;
  v_invested    double precision;
  v_prize_sum   double precision;
  v_roi         double precision;
BEGIN
  FOR v_result IN
    SELECT jsonb_array_elements(COALESCE(p_payload->'results', '[]'::jsonb))
  LOOP
    v_bet_id := (v_result->>'betId')::bigint;
    v_prize  := COALESCE((v_result->>'prize')::double precision, 0);

    INSERT INTO lottery_settlements (bet_id, period, red_hits, blue_hit, prize_tier, prize, profit)
    VALUES (
      v_bet_id,
      v_period,
      (v_result->>'redHits')::smallint,
      (v_result->>'blueHit')::boolean,
      (v_result->>'tier')::smallint,
      v_prize,
      COALESCE((v_result->>'profit')::double precision, 0)
    )
    RETURNING id INTO v_settle_id;

    UPDATE lottery_bets SET status = 'settled' WHERE id = v_bet_id;

    IF v_prize > 0 THEN
      SELECT cash INTO v_cash FROM lottery_account WHERE id = 1;
      INSERT INTO lottery_fund_transactions (type, amount, balance_after, ref_id, note)
      VALUES ('prize', v_prize, v_cash, v_settle_id, v_result->>'prizeNote');
    END IF;
  END LOOP;

  UPDATE lottery_account
     SET cash        = cash + v_prize_total,
         total_prize = total_prize + v_prize_total,
         updated_at  = now()
   WHERE id = 1;

  SELECT cash, total_invested, total_prize
    INTO v_cash, v_invested, v_prize_sum
    FROM lottery_account WHERE id = 1;

  v_roi := CASE
             WHEN v_invested > 0 THEN (v_prize_sum - v_invested) / v_invested
             ELSE 0
           END;

  INSERT INTO lottery_equity_snapshots (period, cash, total_invested, total_prize, cum_profit, roi)
  VALUES (v_period, v_cash, v_invested, v_prize_sum, v_prize_sum - v_invested, v_roi)
  ON CONFLICT (period) DO UPDATE
     SET cash           = EXCLUDED.cash,
         total_invested = EXCLUDED.total_invested,
         total_prize    = EXCLUDED.total_prize,
         cum_profit     = EXCLUDED.cum_profit,
         roi            = EXCLUDED.roi;

  INSERT INTO lottery_operation_log (type, message, detail)
  VALUES ('settle', p_payload->>'logMessage', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION lottery_reset_ledger(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_initial double precision := COALESCE((p_payload->>'initialCapital')::double precision, 100000);
BEGIN
  DELETE FROM lottery_settlements;
  DELETE FROM lottery_bets;
  DELETE FROM lottery_prediction_runs;
  DELETE FROM lottery_equity_snapshots;
  DELETE FROM lottery_fund_transactions;
  DELETE FROM lottery_operation_log;

  INSERT INTO lottery_account (id, initial_capital, cash, total_invested, total_prize)
  VALUES (1, v_initial, v_initial, 0, 0)
  ON CONFLICT (id) DO UPDATE
     SET initial_capital = EXCLUDED.initial_capital,
         cash            = EXCLUDED.cash,
         total_invested  = 0,
         total_prize     = 0,
         updated_at      = now();

  INSERT INTO lottery_fund_transactions (type, amount, balance_after, ref_id, note)
  VALUES ('reset', 0, v_initial, NULL, '账本重置，资金恢复 ' || v_initial::text || ' 元');

  INSERT INTO lottery_operation_log (type, message, detail)
  VALUES ('reset', '模拟盘账本已重置，资金恢复 ' || v_initial::text || ' 元', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION lottery_commit_buy(jsonb)        TO service_role;
GRANT EXECUTE ON FUNCTION lottery_commit_settlement(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION lottery_reset_ledger(jsonb)      TO service_role;
