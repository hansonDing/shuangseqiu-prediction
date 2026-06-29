# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **Database**: Supabase (PostgreSQL)
- **Charts**: Recharts

## 项目概述

双色球智能分析系统 - 基于历史数据的多维度彩票分析 Web 应用，提供频率分析、大小号/奇偶分析、区间分析、智能预测和历史回测功能。

## 目录结构

```
├── public/                          # 静态资源
├── scripts/                         # 构建与启动脚本
│   ├── build.sh / dev.sh / start.sh
│   └── seed.ts                      # 数据库种子脚本
├── src/
│   ├── app/
│   │   ├── api/                     # API 路由
│   │   │   ├── draws/route.ts       # 历史开奖数据
│   │   │   ├── analysis/route.ts    # 多维度分析
│   │   │   ├── predict/route.ts     # 智能预测
│   │   │   └── backtest/route.ts    # 回测验证
│   │   ├── page.tsx                 # 主仪表盘页面
│   │   ├── layout.tsx               # 根布局 (dark mode)
│   │   └── globals.css              # 全局样式
│   ├── components/
│   │   ├── ui/                      # Shadcn UI 组件库
│   │   └── lottery/                 # 彩票相关组件
│   ├── lib/
│   │   ├── lottery-engine.ts        # 分析引擎核心算法
│   │   └── utils.ts                 # 通用工具函数
│   └── storage/database/
│       ├── supabase-client.ts       # Supabase 客户端
│       └── shared/schema.ts         # Drizzle 表结构定义
├── DESIGN.md                        # 设计规范
├── next.config.ts
├── package.json
└── tsconfig.json
```

## 数据库

- **表**: `lottery_draws` - 存储双色球历史开奖数据
- **字段**: period(期号), draw_date(日期), red1-6(红球), blue(蓝球)
- **种子**: `npx tsx scripts/seed.ts` 生成150期模拟数据

## API 接口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/draws` | GET | 获取历史开奖数据 (支持 limit/offset 分页) |
| `/api/analysis` | GET | 获取完整分析结果 (频率/大小/奇偶/区间) |
| `/api/predict` | GET | 生成预测组合 (支持 frequency/recency/balance 权重参数) |
| `/api/backtest` | GET | 历史回测验证 (支持 sample 参数) |

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
