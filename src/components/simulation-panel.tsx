'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Wallet, ShoppingCart, RotateCcw, TrendingUp, TrendingDown, Clock,
} from 'lucide-react';

interface SimStatus {
  account: {
    initial_capital: number;
    cash: number;
    total_invested: number;
    total_prize: number;
  };
  pending: {
    period: string;
    bought_at: string;
    bets: { reds: number[]; blue: number; cost: number }[];
  } | null;
  settlements: {
    period: string; red_hits: number; blue_hit: boolean;
    prize_tier: number; prize: number; profit: number; settled_at: string;
  }[];
  equity: { period: string; cash: number; cum_profit: number; roi: number }[];
  logs: { type: string; message: string; created_at: string }[];
  config: { betCount: number; betCost: number };
}

const TIER_NAMES = ['未中奖', '一等奖', '二等奖', '三等奖', '四等奖', '五等奖', '六等奖'];
const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function RedBall({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-600 text-white text-xs font-bold mx-0.5">
      {String(n).padStart(2, '0')}
    </span>
  );
}

function BlueBall({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold mx-0.5">
      {String(n).padStart(2, '0')}
    </span>
  );
}

export function SimulationPanel() {
  const [data, setData] = useState<SimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'buy' | 'reset' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (kind: 'buy' | 'reset') => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/simulation/${kind}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">模拟盘加载失败：{error}</p>
          <Button variant="outline" className="mt-4" onClick={refresh}>重试</Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground py-12 text-center">加载中...</p>;
  }

  const profit = data.account.total_prize - data.account.total_invested;
  const roi = data.account.total_invested > 0 ? (profit / data.account.total_invested) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* 概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wallet className="w-4 h-4" />当前资金</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">¥{fmt(data.account.cash)}</p></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm">累计投入</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">¥{fmt(data.account.total_invested)}</p></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm">累计奖金</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">¥{fmt(data.account.total_prize)}</p></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {profit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              累计盈亏 / 收益率
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${profit >= 0 ? 'text-red-500' : 'text-green-500'}`}>
              {profit >= 0 ? '+' : ''}{fmt(profit)}
            </p>
            <p className="text-xs text-muted-foreground">ROI {roi.toFixed(2)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-3">
        <Button onClick={() => act('buy')} disabled={busy !== null || !!data.pending}>
          <ShoppingCart className="w-4 h-4 mr-1" />
          {busy === 'buy' ? '买入中...' : '立即买入'}
        </Button>
        <Button
          variant="destructive" onClick={() => {
            if (window.confirm('确定重置模拟盘？所有买入与结算记录将被清空，资金恢复初始值。')) act('reset');
          }}
          disabled={busy !== null}
        >
          <RotateCcw className="w-4 h-4 mr-1" />
          {busy === 'reset' ? '重置中...' : '重置账本'}
        </Button>
        {data.pending && (
          <Badge variant="secondary" className="gap-1">
            <Clock className="w-3 h-3" />
            已有持仓待开奖（{data.pending.period}）
          </Badge>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {/* 当前持仓 */}
      {data.pending && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-base">当前持仓 · 目标期 {data.pending.period}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.pending.bets.map((b, i) => (
                <div key={i} className="flex items-center flex-wrap gap-1">
                  <span className="text-xs text-muted-foreground w-8">#{i + 1}</span>
                  {b.reds.map((r) => <RedBall key={r} n={r} />)}
                  <BlueBall n={b.blue} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 收益曲线 */}
      {data.equity.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-base">收益曲线</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.equity} margin={{ top: 4, right: 12, bottom: 0, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="period" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `¥${fmt(value)}`, name,
                  ]}
                />
                <Legend />
                <Line type="monotone" dataKey="cash" name="资金" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="cum_profit" name="累计盈亏" stroke="#22c55e" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 历史结算 */}
      {data.settlements.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-base">历史结算（最近 50 注）</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/50">
                    <th className="py-2 pr-4">期号</th>
                    <th className="py-2 pr-4">命中</th>
                    <th className="py-2 pr-4">奖级</th>
                    <th className="py-2 pr-4 text-right">奖金</th>
                    <th className="py-2 pr-4 text-right">盈亏</th>
                    <th className="py-2 text-right">结算时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.settlements.map((s, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2 pr-4 font-mono">{s.period}</td>
                      <td className="py-2 pr-4">{s.red_hits}红{s.blue_hit ? '+蓝' : ''}</td>
                      <td className="py-2 pr-4">{TIER_NAMES[s.prize_tier]}</td>
                      <td className="py-2 pr-4 text-right">{fmt(s.prize)}</td>
                      <td className={`py-2 pr-4 text-right ${s.profit >= 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {s.profit >= 0 ? '+' : ''}{fmt(s.profit)}
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground">
                        {new Date(s.settled_at).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 操作日志 */}
      {data.logs.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-base">操作日志</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.logs.map((l, i) => (
                <li key={i}>
                  <Badge variant="outline" className="mr-2">{l.type}</Badge>
                  {l.message}
                  <span className="ml-2 opacity-60">{new Date(l.created_at).toLocaleString('zh-CN')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
