'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface WeeklyKline {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

interface ScreenedStock {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  turnover: number;
  pe: number;
  pb: number;
  marketCap: number;
  weeklyKlines: WeeklyKline[];
  ma20: number;
  trend: 'strong_up' | 'up' | 'neutral' | 'down';
  weeksAboveMA20: number;
  score: number;
}

interface ScreenResult {
  success: boolean;
  data: ScreenedStock[];
  total: number;
  duration: string;
  timestamp: string;
  criteria: {
    description: string;
    conditions: string[];
  };
  error?: string;
}

function TrendBadge({ trend }: { trend: string }) {
  const config: Record<string, { label: string; className: string }> = {
    strong_up: { label: '强势上涨', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    up: { label: '上涨趋势', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
    neutral: { label: '震荡', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    down: { label: '下跌趋势', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  };
  const c = config[trend] || config.neutral;
  return <Badge variant="outline" className={c.className}>{c.label}</Badge>;
}

function MiniKline({ klines, ma20 }: { klines: WeeklyKline[]; ma20: number }) {
  if (!klines || klines.length === 0) return null;

  const allPrices = klines.flatMap(k => [k.high, k.low]);
  const min = Math.min(...allPrices, ma20);
  const max = Math.max(...allPrices, ma20);
  const range = max - min || 1;

  const width = 120;
  const height = 40;
  const barWidth = width / klines.length - 2;

  const scaleY = (price: number) => height - ((price - min) / range) * (height - 4) - 2;

  return (
    <svg width={width} height={height} className="inline-block">
      {/* MA20 line */}
      <line
        x1={0}
        y1={scaleY(ma20)}
        x2={width}
        y2={scaleY(ma20)}
        stroke="#f59e0b"
        strokeWidth={1}
        strokeDasharray="3,2"
        opacity={0.6}
      />
      {/* K-line bars */}
      {klines.map((k, i) => {
        const x = i * (barWidth + 2) + 1;
        const isUp = k.close >= k.open;
        const color = isUp ? '#ef4444' : '#22c55e';
        const bodyTop = scaleY(Math.max(k.open, k.close));
        const bodyBottom = scaleY(Math.min(k.open, k.close));
        const bodyHeight = Math.max(bodyBottom - bodyTop, 1);

        return (
          <g key={i}>
            {/* Shadow line */}
            <line
              x1={x + barWidth / 2}
              y1={scaleY(k.high)}
              x2={x + barWidth / 2}
              y2={scaleY(k.low)}
              stroke={color}
              strokeWidth={1}
            />
            {/* Body */}
            <rect
              x={x}
              y={bodyTop}
              width={barWidth}
              height={bodyHeight}
              fill={isUp ? color : color}
              stroke={color}
              strokeWidth={0.5}
              opacity={isUp ? 0.8 : 0.6}
            />
          </g>
        );
      })}
    </svg>
  );
}

function ScoreBar({ score }: { score: number }) {
  const maxScore = 100;
  const percent = Math.min((score / maxScore) * 100, 100);
  const color = score >= 80 ? 'bg-red-500' : score >= 60 ? 'bg-orange-500' : score >= 40 ? 'bg-yellow-500' : 'bg-gray-500';

  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-300">{score}</span>
    </div>
  );
}

export default function StockScreenerPage() {
  const [result, setResult] = useState<ScreenResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScreen = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/screen');
      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || '筛选失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] to-[#111827] text-gray-100">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            A股智能选股系统
          </h1>
          <p className="text-gray-400 mt-2">
            基于周K线趋势分析，筛选近期最可能上涨的股票
          </p>
        </div>

        {/* Criteria Card */}
        <Card className="mb-6 bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-lg text-cyan-400">选股条件</CardTitle>
            <CardDescription className="text-gray-400">
              以下条件同时满足的股票将被筛选出来
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { icon: '🚫', text: '排除创业板(300开头)和科创板(688开头)' },
                { icon: '🚫', text: '排除ST/*ST风险警示股票' },
                { icon: '📈', text: '最近3周周K线收盘价均在20周均线以上' },
                { icon: '📊', text: '最近3周呈持续上涨趋势(每周收盘价递增)' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-900/50">
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-sm text-gray-300">{item.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Action Button */}
        <div className="mb-6 flex items-center gap-4">
          <Button
            onClick={handleScreen}
            disabled={loading}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-8 py-6 text-lg"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                正在筛选...
              </span>
            ) : (
              '开始选股'
            )}
          </Button>

          {result && (
            <div className="text-sm text-gray-400">
              找到 <span className="text-cyan-400 font-bold">{result.total}</span> 只符合条件的股票
              <span className="ml-2 text-gray-500">({result.duration})</span>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="pt-6">
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 bg-gray-700" />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {error && (
          <Card className="bg-red-900/20 border-red-700">
            <CardContent className="pt-6">
              <p className="text-red-400">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Results Table */}
        {result && result.data.length > 0 && (
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-lg text-cyan-400">
                筛选结果
                <span className="text-sm text-gray-400 ml-2 font-normal">
                  (按综合评分排序)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-700">
                      <TableHead className="text-gray-400 w-12">排名</TableHead>
                      <TableHead className="text-gray-400">代码</TableHead>
                      <TableHead className="text-gray-400">名称</TableHead>
                      <TableHead className="text-gray-400 text-right">现价</TableHead>
                      <TableHead className="text-gray-400 text-right">涨跌幅</TableHead>
                      <TableHead className="text-gray-400 text-right">20周均线</TableHead>
                      <TableHead className="text-gray-400 text-center">趋势</TableHead>
                      <TableHead className="text-gray-400 text-center">周K线</TableHead>
                      <TableHead className="text-gray-400 text-right">换手率</TableHead>
                      <TableHead className="text-gray-400 text-right">PE</TableHead>
                      <TableHead className="text-gray-400 text-center">评分</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.map((stock, index) => (
                      <TableRow key={stock.code} className="border-gray-700/50 hover:bg-gray-700/30">
                        <TableCell className="font-mono text-gray-500">{index + 1}</TableCell>
                        <TableCell className="font-mono text-cyan-400">{stock.code}</TableCell>
                        <TableCell className="font-medium">{stock.name}</TableCell>
                        <TableCell className="text-right font-mono">{stock.price.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-mono ${stock.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-yellow-400">{stock.ma20.toFixed(2)}</TableCell>
                        <TableCell className="text-center">
                          <TrendBadge trend={stock.trend} />
                        </TableCell>
                        <TableCell className="text-center">
                          <MiniKline klines={stock.weeklyKlines} ma20={stock.ma20} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-gray-300">{stock.turnover.toFixed(2)}%</TableCell>
                        <TableCell className="text-right font-mono text-gray-300">{stock.pe.toFixed(1)}</TableCell>
                        <TableCell className="text-center">
                          <ScoreBar score={stock.score} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {result && result.data.length === 0 && (
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="pt-6 text-center py-12">
              <p className="text-gray-400 text-lg">当前没有符合所有条件的股票</p>
              <p className="text-gray-500 text-sm mt-2">市场可能处于调整期，请稍后再试</p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>数据来源: 东方财富 | 仅供参考，不构成投资建议</p>
          <p className="mt-1">选股策略: 周K线趋势跟踪 | 20周均线支撑</p>
        </div>
      </div>
    </div>
  );
}
