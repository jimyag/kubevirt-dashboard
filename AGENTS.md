# AGENTS.md — kubevirt-console

本文件为 Coding Agent（Claude Code、Codex、Cursor 等）在此仓库工作时提供约束。

---

## 项目结构

```
kubevirt-console/
├── ui/              # kubevirt-dashboard 前端（本文件约束范围）
│   └── src/
│       ├── components/ui/   # shadcn/ui 组件，勿直接修改组件本体
│       ├── components/console.tsx  # 控制台共享组件
│       ├── lib/         # API、发现、网络栈、导航等逻辑
│       ├── pages/       # 控制台页面
│       └── index.css        # OKLCH 色彩 token + 字体定义
└── internal/        # Go 后端
```

---

## UI 主题规范（强制约束）

以下规则强制执行，所有 UI 改动必须遵守。

### 1. 字体

- 界面字体：Geist（`--font-sans`，`'Geist Variable'`）
- 等宽字体（代码、IP、ID、终端）：Geist Mono（`--font-mono`，`'Geist Mono Variable'`）
- 字体通过 `@fontsource-variable/geist`、`@fontsource-variable/geist-mono` 自托管，在 `main.tsx` 引入；禁止从 CDN 加载字体或引入其他字体

### 2. 色彩系统

只使用语义化 Tailwind token，禁止硬编码颜色。主题为中性 slate 画布 + 白色表面 + indigo 品牌色，暗色模式为深 slate（非纯黑）。

禁止使用的 class：`bg-white`、`text-zinc-*`、`bg-zinc-*`、`border-zinc-*`、`text-gray-*`、`bg-gray-*`

| 用途 | Token |
|------|-------|
| 主文字 | `text-foreground` |
| 次要文字 | `text-muted-foreground` |
| 页面画布 | `bg-background` |
| 卡片 / 表格 / 弹窗表面 | `bg-card` |
| 静音背景、表头 | `bg-muted`、`bg-muted/50` |
| 边框 | `border` / `border-border` |
| 主色 | `text-primary` / `bg-primary` |
| 选中、高亮 | `bg-accent` / `text-accent-foreground` |
| 行悬停 | `hover:bg-muted/40` |

色彩变量定义在 `ui/src/index.css`，使用 OKLCH 色彩空间。状态色（成功 / 警告 / 失败）只通过 `StatusDot`、`Badge` 等共享组件使用。

### 3. 组件库

- 使用 shadcn/ui（new-york 风格），组件位于 `ui/src/components/ui/`，勿直接修改组件本体
- 控制台页面优先使用 `ui/src/components/console.tsx` 中的共享组件，不要在页面里重复手写同类样式：
  - `PageHeader`、`Section`：页面标题与分区
  - `DataTable`、`Toolbar`：资源列表与筛选栏
  - `StatusDot`：资源状态（根据文本自动着色）
  - `StatTile`、`IconBadge`、`UsageBar`：指标与容量
  - `KeyValueGrid`：详情字段
  - `ChoiceCard`、`TabBar`、`FieldRow`、`NativeSelect`：表单与选项
  - `ConfirmDialog`、`ErrorNote`、`EmptyState`、`LoadingState`：交互反馈
- 导航数据集中在 `ui/src/lib/navigation.ts`，侧边栏、顶栏面包屑和 ⌘K 命令面板共用

### 4. 设计模式

- 页面结构：`PageHeader`（标题 `text-2xl font-semibold tracking-tight` + 副标题 + 右侧操作）→ 可选 Tab → `Toolbar` → `DataTable` / 卡片
- 列表：名称列用 `Link` + `font-medium hover:text-primary`，命名空间等次要信息放在名称下方的 `text-xs text-muted-foreground`
- 详情：优先用一个分栏汇总卡片 + `KeyValueGrid`，避免大量零散小卡片
- 选择型输入（规格、镜像、引擎等）使用 `ChoiceCard`，而不是长下拉框
- IP、CIDR、ID 等技术值使用 `font-mono`
- 指标图标颜色：hosts=blue，instances=green，storage=purple，network=cyan，platform=orange

### 5. 圆角与排版

- 圆角：`rounded-lg`（`--radius: 0.625rem`），状态胶囊用 `rounded-full`；禁止 `rounded-2xl`、`rounded-3xl`
- 字重：`font-medium` / `font-semibold`（禁止 `font-black`）
- 排版：正常大小写，禁止 `uppercase tracking-widest` 等过度强调写法

### 6. 暗色模式

- 所有颜色 class 必须同时覆盖 light/dark
- 彩色半透明背景格式：`bg-blue-500/10 text-blue-600 dark:text-blue-400`
- 暗色模式通过 `next-themes`（`ThemeProvider`）管理，在 `main.tsx` 配置

---

## 依赖规范

`ui/` 使用 **bun** 作为包管理器（`bun.lock` 是唯一 lock 文件）。

当前核心依赖：
- 构建：Vite + `@vitejs/plugin-react-swc` + `@tailwindcss/vite`（无需 postcss/autoprefixer）
- 样式：Tailwind CSS v4 + `tw-animate-css`（不使用 `tailwindcss-animate`）
- 组件：shadcn/ui（Radix UI 原语）+ `class-variance-authority`
- 主题：`next-themes`
- 字体：`@fontsource-variable/geist`、`@fontsource-variable/geist-mono`
- 命令面板：`cmdk`
- Toast：`sonner`

禁止引入：
- `tailwindcss-animate`（已被 `tw-animate-css` 替代）
- `postcss` / `autoprefixer`（Tailwind v4 不需要）
- `@vitejs/plugin-react`（使用 swc 版本）
- `@types/react-router-dom`（v7 自带类型）
