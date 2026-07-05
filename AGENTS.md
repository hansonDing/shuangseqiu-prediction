# AGENTS.md

## 项目概述
A股智能选股系统 - 基于周K线趋势分析的股票筛选Web应用

## 技术栈
- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **数据源**: 东方财富公开API

## 目录结构
```
src/
├── app/
│   ├── api/screen/route.ts  # 选股API
│   ├── page.tsx             # 主页面
│   ├── layout.tsx           # 根布局
│   └── globals.css          # 全局样式
├── lib/
│   └── stock-screener.ts    # 选股引擎
└── components/ui/           # shadcn组件
```

## API接口
| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/screen` | GET | 执行选股筛选 |

## 选股逻辑
1. 获取A股列表(排除创业板300/科创板688/ST股)
2. 批量获取周K线数据(最近30周)
3. 计算20周均线
4. 筛选条件: 最近3周收盘价>MA20 且 连续3周上涨
5. 综合评分排序输出

## 包管理
仅使用 pnpm
