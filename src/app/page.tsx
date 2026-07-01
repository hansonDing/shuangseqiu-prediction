'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  TrendingUp, BarChart3, Target, History, RefreshCw,
  CircleDot, Activity, Zap, Award, Download, CheckCircle2,
  AlertCircle, Clock,
} from 'lucide-react';

interface FrequencyItem {
  number: number;
  count: number;
  rate: number;
  last_seen: number;
  avg_interval: number;
}

interface AnalysisData {
  frequency: { red: FrequencyItem[]; blue: FrequencyItem[] };
  bigSmall: { big_count: number; small_count: number; trend: { period: string; big: number; small: number }[] };
  oddEven: { odd_count: number; even_count: number; trend: { period: string; odd: number; even: number }[] };
  zones: { zone: string; count: number; rate: number }[];
  recent_draws: DrawRecord[];
}

interface DrawRecord {
  id: number;
  period: string;
  draw_date: string;
  red1: number;
  red2: number;
  red3: number;
  red4: number;
  red5: number;
  red6: number;
  blue: number;
}

interface PredictionCombo {
  reds: number[];
  blue: number;
  score: number;
  reason: string;
}

interface BacktestResult {
  total_periods: number;
  tested_periods: number;
  avg_red_hits: number;
  avg_blue_hits: number;
  red_hit_distribution: { hits: number; count: number }[];
  blue_hit_rate: number;
  blue_top3_hit_rate?: number;
  blue_first_hit_rate?: number;
  recent_tests: {
    period: string;
    predicted_reds: number[];
    predicted_blue: number;
    actual_reds: number[];
    actual_blue: number;
    red_hits: number;
    blue_hit: boolean;
  }[];
}

// 号码球组件
function Ball({ number, type = 'red', size = 'md', highlight = false }: {
  number: number;
  type?: 'red' | 'blue';
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
}) {
  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-11 h-11 text-base',
  };

  const colorClasses = type === 'red'
    ? 'bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-rose-500/30'
    : 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-blue-500/30';

  return (
    <div className={`
      ${sizeClasses[size]} ${colorClasses}
      rounded-full flex items-center justify-center font-mono font-bold
      shadow-lg transition-all duration-300
      ${highlight ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background scale-110' : ''}
    `}>
      {number.toString().padStart(2, '0')}
    </div>
  );
}

// 统计卡片
function StatCard({ title, value, subtitle, icon: Icon }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="bg-card/50 border-border/50 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-xl font-bold font-mono">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 号码热力图
function Heatmap({ data, type }: { data: FrequencyItem[]; type: 'red' | 'blue' }) {
  const maxCount = Math.max(...data.map((d) => d.count));
  const cols = type === 'red' ? 11 : 8;

  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {data.map((item) => {
        const intensity = item.count / maxCount;
        const bgColor = type === 'red'
          ? `rgba(225, 29, 72, ${0.15 + intensity * 0.85})`
          : `rgba(37, 99, 235, ${0.15 + intensity * 0.85})`;

        return (
          <div
            key={item.number}
            className="relative group aspect-square rounded-lg flex flex-col items-center justify-center cursor-pointer transition-transform hover:scale-105"
            style={{ backgroundColor: bgColor }}
          >
            <span className="font-mono font-bold text-sm text-white">
              {item.number.toString().padStart(2, '0')}
            </span>
            <span className="text-[10px] text-white/70">{item.count}次</span>
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-popover border border-border rounded-md px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
              <p>出现 {item.count} 次 ({item.rate}%)</p>
              <p>遗漏 {item.last_seen} 期</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 加载骨架
function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

export default function LotteryDashboard() {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [predictions, setPredictions] = useState<PredictionCombo[]>([]);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [weights, setWeights] = useState({ frequency: 0.4, recency: 0.35, balance: 0.25 });
  const [activeTab, setActiveTab] = useState('overview');
  const [updateStatus, setUpdateStatus] = useState<{
    updating: boolean;
    lastUpdate: string | null;
    message: string | null;
    error: boolean;
  }>({ updating: false, lastUpdate: null, message: null, error: false });

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analysis');
      const data = await res.json();
      setAnalysis(data);
    } catch (err) {
      console.error('Failed to fetch analysis:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const handleUpdateData = async () => {
    setUpdateStatus({ updating: true, lastUpdate: null, message: '正在获取最新开奖数据...', error: false });
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setUpdateStatus({
          updating: false,
          lastUpdate: data.last_update,
          message: data.message,
          error: false,
        });
        // 刷新分析数据
        fetchAnalysis();
      } else {
        setUpdateStatus({
          updating: false,
          lastUpdate: null,
          message: data.error || '更新失败',
          error: true,
        });
      }
    } catch (err) {
      setUpdateStatus({
        updating: false,
        lastUpdate: null,
        message: '网络错误，请稍后重试',
        error: true,
      });
    }
  };

  const handlePredict = async () => {
    setPredicting(true);
    try {
      const params = new URLSearchParams({
        frequency: weights.frequency.toString(),
        recency: weights.recency.toString(),
        balance: weights.balance.toString(),
      });
      const res = await fetch(`/api/predict?${params}`);
      const data = await res.json();
      setPredictions(data.predictions || []);
    } catch (err) {
      console.error('Prediction failed:', err);
    } finally {
      setPredicting(false);
    }
  };

  const handleBacktest = async () => {
    setBacktesting(true);
    try {
      const res = await fetch('/api/backtest?sample=30');
      const data = await res.json();
      setBacktestResult(data);
    } catch (err) {
      console.error('Backtest failed:', err);
    } finally {
      setBacktesting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <LoadingSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-blue-600 flex items-center justify-center">
                <CircleDot className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">双色球智能分析系统</h1>
                <p className="text-xs text-muted-foreground">基于历史数据的多维度分析引擎</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleUpdateData}
                disabled={updateStatus.updating}
                className="gap-2"
              >
                {updateStatus.updating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {updateStatus.updating ? '更新中...' : '更新数据'}
              </Button>
              <Button variant="outline" size="sm" onClick={fetchAnalysis}>
                <RefreshCw className="w-4 h-4 mr-2" />
                刷新
              </Button>
            </div>
          </div>
          {/* Update Status Bar */}
          {updateStatus.message && (
            <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              updateStatus.error
                ? 'bg-destructive/10 text-destructive'
                : 'bg-emerald-500/10 text-emerald-400'
            }`}>
              {updateStatus.error ? (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{updateStatus.message}</span>
              {updateStatus.lastUpdate && (
                <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {updateStatus.lastUpdate}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-card/50 border border-border/50">
            <TabsTrigger value="overview" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              数据总览
            </TabsTrigger>
            <TabsTrigger value="frequency" className="gap-2">
              <Activity className="w-4 h-4" />
              频率分析
            </TabsTrigger>
            <TabsTrigger value="predict" className="gap-2">
              <Target className="w-4 h-4" />
              智能预测
            </TabsTrigger>
            <TabsTrigger value="backtest" className="gap-2">
              <History className="w-4 h-4" />
              回测验证
            </TabsTrigger>
            <TabsTrigger value="datasource" className="gap-2">
              <Download className="w-4 h-4" />
              数据管理
            </TabsTrigger>
          </TabsList>

          {/* 数据总览 */}
          <TabsContent value="overview" className="space-y-6">
            {/* 统计卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                title="总期数"
                value={analysis?.recent_draws.length ? `${analysis.recent_draws[0]?.period}` : '-'}
                subtitle={`共 ${analysis?.frequency.red.reduce((s, f) => s + f.count, 0) ? Math.round(analysis.frequency.red.reduce((s, f) => s + f.count, 0) / 6) : 0} 期`}
                icon={BarChart3}
              />
              <StatCard
                title="最热红球"
                value={analysis ? `${analysis.frequency.red.sort((a, b) => b.count - a.count)[0]?.number.toString().padStart(2, '0')}` : '-'}
                subtitle={analysis ? `出现 ${analysis.frequency.red[0]?.count} 次` : ''}
                icon={TrendingUp}
              />
              <StatCard
                title="最热蓝球"
                value={analysis ? `${analysis.frequency.blue.sort((a, b) => b.count - a.count)[0]?.number.toString().padStart(2, '0')}` : '-'}
                subtitle={analysis ? `出现 ${analysis.frequency.blue[0]?.count} 次` : ''}
                icon={Zap}
              />
              <StatCard
                title="奇偶比"
                value={analysis ? `${(analysis.oddEven.odd_count / (analysis.oddEven.odd_count + analysis.oddEven.even_count) * 100).toFixed(1)}%` : '-'}
                subtitle="奇数占比"
                icon={Award}
              />
            </div>

            {/* 最近开奖 */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  最近开奖记录
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysis?.recent_draws.slice(0, 10).map((draw) => (
                    <div key={draw.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                      <span className="text-xs text-muted-foreground font-mono w-20">{draw.period}</span>
                      <span className="text-xs text-muted-foreground w-24">{draw.draw_date}</span>
                      <div className="flex gap-1.5">
                        {[draw.red1, draw.red2, draw.red3, draw.red4, draw.red5, draw.red6]
                          .sort((a, b) => a - b)
                          .map((r, i) => (
                            <Ball key={i} number={r} type="red" size="sm" />
                          ))}
                      </div>
                      <Ball number={draw.blue} type="blue" size="sm" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 大小号 & 奇偶趋势 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">大小号趋势 (近30期)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={analysis?.bigSmall.trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(-3)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                      />
                      <Area type="monotone" dataKey="big" name="大号" stackId="1" fill="rgba(225,29,72,0.3)" stroke="#e11d48" />
                      <Area type="monotone" dataKey="small" name="小号" stackId="1" fill="rgba(6,182,212,0.3)" stroke="#06b6d4" />
                      <Legend />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">奇偶趋势 (近30期)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={analysis?.oddEven.trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(-3)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                      />
                      <Area type="monotone" dataKey="odd" name="奇数" stackId="1" fill="rgba(245,158,11,0.3)" stroke="#f59e0b" />
                      <Area type="monotone" dataKey="even" name="偶数" stackId="1" fill="rgba(16,185,129,0.3)" stroke="#10b981" />
                      <Legend />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* 区间分布 */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">红球区间分布</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={analysis?.zones}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="zone" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                      labelStyle={{ color: '#e2e8f0' }}
                      formatter={(value: number, name: string) => [`${value} (${(value / (analysis?.frequency.red.reduce((s, f) => s + f.count, 0) || 1) * 100).toFixed(1)}%)`, name]}
                    />
                    <Bar dataKey="count" name="出现次数" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                    <defs>
                      <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#0891b2" stopOpacity={0.6} />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 频率分析 */}
          <TabsContent value="frequency" className="space-y-6">
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500" />
                  红球频率热力图
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analysis && <Heatmap data={analysis.frequency.red} type="red" />}
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  蓝球频率热力图
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analysis && <Heatmap data={analysis.frequency.blue} type="blue" />}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">红球频率排行</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart
                      data={analysis?.frequency.red.sort((a, b) => b.count - a.count).slice(0, 15)}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis type="category" dataKey="number" tick={{ fontSize: 10, fill: '#94a3b8' }} width={30} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                      />
                      <Bar dataKey="count" name="出现次数" fill="#e11d48" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">蓝球频率排行</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart
                      data={analysis?.frequency.blue.sort((a, b) => b.count - a.count)}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis type="category" dataKey="number" tick={{ fontSize: 10, fill: '#94a3b8' }} width={30} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                      />
                      <Bar dataKey="count" name="出现次数" fill="#2563eb" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* 遗漏分析 */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">红球遗漏期数 (越大越久未出现)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={analysis?.frequency.red.sort((a, b) => a.number - b.number)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="number" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Bar dataKey="last_seen" name="遗漏期数" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 智能预测 */}
          <TabsContent value="predict" className="space-y-6">
            {/* 算法说明 */}
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground mb-1">多策略融合预测引擎 v2</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      综合4种策略生成预测：频率统计 + 近期热度(时间衰减) + 渐进遗漏回补 + 共现矩阵分析。
                      每组号码经过6项约束过滤：奇偶比(2:4~4:2)、大小比(2:4~4:2)、区间覆盖(≥4区)、和值范围(60~150)、跨度(≥18)、连号(≤2组)。
                      组合生成采用确定性算法，相同参数始终产生相同结果。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 参数调节 */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  预测参数调节
                </CardTitle>
                <p className="text-xs text-muted-foreground">调节三种策略的权重比例，影响号码评分排序</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">频率权重 (历史出现频率)</span>
                      <span className="font-mono">{(weights.frequency * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                      value={[weights.frequency * 100]}
                      onValueChange={(v: number[]) => setWeights((w) => ({ ...w, frequency: v[0] / 100 }))}
                      min={0}
                      max={100}
                      step={5}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">近期热度权重 (时间衰减加权)</span>
                      <span className="font-mono">{(weights.recency * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                      value={[weights.recency * 100]}
                      onValueChange={(v: number[]) => setWeights((w) => ({ ...w, recency: v[0] / 100 }))}
                      min={0}
                      max={100}
                      step={5}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">遗漏回补权重 (冷号回补概率)</span>
                      <span className="font-mono">{(weights.balance * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                      value={[weights.balance * 100]}
                      onValueChange={(v: number[]) => setWeights((w) => ({ ...w, balance: v[0] / 100 }))}
                      min={0}
                      max={100}
                      step={5}
                    />
                  </div>
                </div>
                <Button onClick={handlePredict} disabled={predicting} className="w-full md:w-auto">
                  {predicting ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      生成预测
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* 预测结果 */}
            {predictions.length > 0 && (
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-500" />
                    推荐组合 ({predictions.length} 组)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {predictions.map((combo, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col md:flex-row md:items-center gap-3 p-4 rounded-xl bg-secondary/30 border border-border/30 hover:border-primary/30 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-[60px]">
                          <Badge variant={idx < 3 ? 'default' : 'secondary'} className="font-mono">
                            #{idx + 1}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {combo.score.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {combo.reds.map((r, i) => (
                            <Ball key={i} number={r} type="red" size="sm" />
                          ))}
                          <Ball number={combo.blue} type="blue" size="sm" />
                        </div>
                        <p className="text-xs text-muted-foreground md:ml-auto">{combo.reason}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {predictions.length === 0 && !predicting && (
              <Card className="bg-card/50 border-border/50">
                <CardContent className="py-12 text-center">
                  <Target className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">调节参数后点击"生成预测"按钮</p>
                  <p className="text-xs text-muted-foreground mt-1">系统将基于历史数据生成推荐号码组合</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 回测验证 */}
          <TabsContent value="backtest" className="space-y-6">
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  历史回测验证
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  使用历史数据验证预测算法的准确率。系统会用前 N-1 期数据预测第 N 期，并与实际开奖结果对比。
                </p>
                <Button onClick={handleBacktest} disabled={backtesting}>
                  {backtesting ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      回测中...
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4 mr-2" />
                      开始回测 (30期)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {backtestResult && (
              <>
                {/* 回测统计 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    title="回测期数"
                    value={backtestResult.tested_periods}
                    subtitle={`总 ${backtestResult.total_periods} 期`}
                    icon={BarChart3}
                  />
                  <StatCard
                    title="平均红球命中"
                    value={backtestResult.avg_red_hits}
                    subtitle="每期命中数"
                    icon={Target}
                  />
                  <StatCard
                    title="蓝球命中率"
                    value={`${backtestResult.blue_hit_rate}%`}
                    subtitle="8组推荐覆盖命中率"
                    icon={Zap}
                  />
                  <StatCard
                    title="蓝球首选命中"
                    value={`${backtestResult.blue_first_hit_rate ?? 0}%`}
                    subtitle="第一推荐蓝球命中率"
                    icon={Target}
                  />
                  <StatCard
                    title="最高命中"
                    value={Math.max(...backtestResult.red_hit_distribution.filter((d) => d.count > 0).map((d) => d.hits), 0)}
                    subtitle="单期最多红球命中"
                    icon={Award}
                  />
                </div>

                {/* 命中分布 */}
                <Card className="bg-card/50 border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">红球命中数分布</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={backtestResult.red_hit_distribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="hits" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `${v}个`} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                          labelStyle={{ color: '#e2e8f0' }}
                          formatter={(value: number) => [`${value} 期`, '次数']}
                          labelFormatter={(v: number) => `命中 ${v} 个红球`}
                        />
                        <Bar dataKey="count" name="次数" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* 详细回测记录 */}
                <Card className="bg-card/50 border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">近期回测详情</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {backtestResult.recent_tests.map((test) => (
                        <div key={test.period} className="p-3 rounded-lg bg-secondary/20 border border-border/30">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="font-mono text-xs">{test.period}</Badge>
                            <Badge variant={test.red_hits >= 3 ? 'default' : 'secondary'} className="text-xs">
                              红球命中 {test.red_hits}/6
                            </Badge>
                            <Badge variant={test.blue_hit ? 'default' : 'secondary'} className="text-xs">
                              蓝球 {test.blue_hit ? '命中' : '未中'}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-4 text-xs">
                            <div>
                              <span className="text-muted-foreground">预测: </span>
                              <span className="font-mono">
                                {test.predicted_reds.map((r) => r.toString().padStart(2, '0')).join(' ')}
                              </span>
                              <span className="text-blue-400 font-mono ml-1">+{test.predicted_blue.toString().padStart(2, '0')}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">实际: </span>
                              <span className="font-mono">
                                {test.actual_reds.map((r) => r.toString().padStart(2, '0')).join(' ')}
                              </span>
                              <span className="text-blue-400 font-mono ml-1">+{test.actual_blue.toString().padStart(2, '0')}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {!backtestResult && !backtesting && (
              <Card className="bg-card/50 border-border/50">
                <CardContent className="py-12 text-center">
                  <History className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">点击"开始回测"验证预测算法</p>
                  <p className="text-xs text-muted-foreground mt-1">系统将使用最近30期数据进行回测分析</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 数据管理 */}
          <TabsContent value="datasource" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 数据更新 */}
              <Card className="bg-card/50 border-border/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Download className="w-4 h-4 text-cyan-400" />
                    数据更新
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded-lg bg-secondary/20 border border-border/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">数据来源</span>
                      <span className="text-sm font-medium">中彩网 (zhcw.com)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">更新频率</span>
                      <Badge variant="outline" className="text-cyan-400 border-cyan-400/30">每周一、三、五自动更新</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">开奖日</span>
                      <span className="text-sm font-medium">每周二、四、日</span>
                    </div>
                    {updateStatus.lastUpdate && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">最近更新</span>
                        <span className="text-sm font-medium text-emerald-400">{updateStatus.lastUpdate}</span>
                      </div>
                    )}
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleUpdateData}
                    disabled={updateStatus.updating}
                  >
                    {updateStatus.updating ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        正在获取最新数据...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        立即更新数据
                      </>
                    )}
                  </Button>
                  {updateStatus.message && (
                    <div className={`text-xs px-3 py-2 rounded-lg ${
                      updateStatus.error
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {updateStatus.message}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 数据概况 */}
              <Card className="bg-card/50 border-border/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4 text-amber-400" />
                    数据概况
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded-lg bg-secondary/20 border border-border/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">总期数</span>
                      <span className="text-sm font-mono font-bold text-amber-400">
                        {analysis?.recent_draws?.length || 0} 期
                      </span>
                    </div>
                    {analysis?.recent_draws && analysis.recent_draws.length > 0 && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">最新一期</span>
                          <Badge variant="outline" className="font-mono">
                            {analysis.recent_draws[0].period}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">开奖日期</span>
                          <span className="text-sm font-medium">
                            {analysis.recent_draws[0].draw_date}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">最早一期</span>
                          <Badge variant="outline" className="font-mono">
                            {analysis.recent_draws[analysis.recent_draws.length - 1].period}
                          </Badge>
                        </div>
                      </>
                    )}
                  </div>
                  {analysis?.recent_draws && analysis.recent_draws.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">最新开奖号码</p>
                      <div className="flex items-center gap-1.5">
                        {[analysis.recent_draws[0].red1, analysis.recent_draws[0].red2, analysis.recent_draws[0].red3,
                          analysis.recent_draws[0].red4, analysis.recent_draws[0].red5, analysis.recent_draws[0].red6
                        ].sort((a, b) => a - b).map((n, i) => (
                          <Ball key={i} number={n} type="red" size="sm" />
                        ))}
                        <Ball number={analysis.recent_draws[0].blue} type="blue" size="sm" />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* 定时任务说明 */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  自动更新计划
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { day: '周一', desc: '获取周日开奖数据', icon: '1' },
                    { day: '周三', desc: '获取周二开奖数据', icon: '3' },
                    { day: '周五', desc: '获取周四开奖数据', icon: '5' },
                  ].map((item) => (
                    <div key={item.day} className="p-4 rounded-lg bg-secondary/20 border border-border/30 text-center">
                      <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm flex items-center justify-center mx-auto mb-2">
                        {item.icon}
                      </div>
                      <p className="text-sm font-medium">{item.day}</p>
                      <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4 text-center">
                  系统在服务启动时自动检查并执行更新计划，也可随时点击"立即更新"手动获取最新数据
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 mt-12">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
          <p className="text-xs text-muted-foreground text-center">
            本系统仅供数据分析参考，彩票开奖为随机事件，任何预测均不构成投注建议
          </p>
        </div>
      </footer>
    </div>
  );
}
