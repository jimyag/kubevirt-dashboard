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

- 界面字体：IBM Plex Sans（`--font-sans`，400 / 500 / 600）
- 等宽字体（代码、IP、CIDR、ID、终端）：IBM Plex Mono（`--font-mono`）
- 字体通过 `@fontsource/ibm-plex-sans`、`@fontsource/ibm-plex-mono` 自托管，在 `main.tsx` 引入；禁止从 CDN 加载字体或引入其他字体

### 2. 色彩系统

只使用语义化 Tailwind token，禁止硬编码颜色。主题为冷灰画布 + 白色表面 + 钴蓝主色（`--primary`）。

颜色有三种用途，不要用于其他装饰：
- 主色：主操作按钮、选中项、链接悬停
- 状态色：绿 / 琥珀 / 红，只通过 `StatusDot` 等共享组件使用
- 分区色：每个导航分区一个色相，由 `ui/src/index.css` 中的 `--tone-*` token 定义（同一亮度与彩度，色相在主色附近的冷色区间：Networking 190、Storage 222、Compute 255、Platform 285、Security 315），通过 `ui/src/lib/navigation.ts` 的 `toneClasses` 使用（`text-tone-*` / `bg-tone-*`），用于侧边栏图标、面包屑、页面标题图标和总览指标；不要改用 Tailwind 调色板颜色，新增分区时保持相同亮度与彩度

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
  - `PageHeader`、`Section`、`Panel`：页面标题、分区、带标题栏的内容块（详情页默认容器）
  - `DataTable`、`Toolbar`：资源列表与筛选栏
  - `StatusDot`：资源状态，圆点 + 文字（根据文本自动着色）
  - `StatTile`、`UsageBar`：指标与容量
  - `KeyValueGrid`：详情字段
  - `ChoiceCard`、`TabBar`、`FieldRow`、`NativeSelect`：表单与选项
  - `Combobox`、`FilterInput`、`Pager`：列表筛选。筛选一律用可输入的 `Combobox`（不用下拉选择）；搜索框用 `FilterInput` + `lib/filter.ts` 的 `useFilteredRows`，支持对展示列做 `field:value` 筛选；长列表用 `usePaged` + `Pager` 分页
  - `ConfirmDialog`、`ErrorNote`、`EmptyState`、`LoadingState`：交互反馈
- 导航数据集中在 `ui/src/lib/navigation.ts`，侧边栏、顶栏面包屑和 ⌘K 命令面板共用

### 4. 设计模式

- 页面结构：`PageHeader`（标题 `text-xl font-semibold` + 右侧操作）→ 可选 Tab → `Toolbar` → `DataTable` / `Panel`
- 文案克制：副标题只写事实（例如资源 Kind / API），不写解释性句子；空状态只写一句结论，不写引导语
- 不使用装饰性元素：不加入场动画、脉冲 / ping 动画、渐变、彩色图标底块；一个页面里不要堆叠大量小卡片
- 列表：名称列用 `Link` + `font-medium hover:text-primary`，命名空间等次要信息放在名称下方的 `text-xs text-muted-foreground`
- 详情：优先用一个分栏汇总卡片 + `KeyValueGrid`，避免大量零散小卡片
- 选择型输入（规格、镜像、引擎等）使用 `ChoiceCard`，而不是长下拉框
- IP、CIDR、ID、Kind、apiVersion 等技术值使用 `font-mono`
- 时间统一显示相对时间（`relativeTime`），完整时间放在 `title` 里
- 删除操作必须经过 `ConfirmDialog` 确认

### 5. 圆角与排版

- 圆角：`rounded-lg` / `rounded-md`（`--radius: 0.375rem`）；禁止 `rounded-2xl`、`rounded-3xl`
- 字重：`font-medium` / `font-semibold`（禁止 `font-black`）
- 排版：正常大小写，禁止 `uppercase tracking-widest` 等过度强调写法

### 6. 暗色模式

- 所有颜色 class 必须同时覆盖 light/dark
- 状态色同时给出暗色值，例如 `text-red-700 dark:text-red-400`
- 暗色模式通过 `next-themes`（`ThemeProvider`）管理，在 `main.tsx` 配置

### 7. 国际化

- 所有界面文案用英文书写并通过 `lib/i18n.ts` 的 `t()` 输出，例如 `t("Create instance")`、`t("Delete {name}?", { name })`；英文原文即 key，缺少翻译时回退为英文
- 新增或修改文案时，同步在 `ui/src/lib/locales/zh.ts` 中补充简体中文翻译
- 只在渲染时调用 `t()`，不要在模块顶层调用（切换语言会重新挂载界面，但模块级常量不会重新计算）；模块级的标签数组保留英文，在渲染处再 `t(item.label)`
- 资源名称、Kind、字段值等技术内容不翻译；`StatusDot` 的 `status` 传原始英文状态（用于判断颜色），显示时会自动翻译

---

## 依赖规范

`ui/` 使用 **bun** 作为包管理器（`bun.lock` 是唯一 lock 文件）。

当前核心依赖：
- 构建：Vite + `@vitejs/plugin-react-swc` + `@tailwindcss/vite`（无需 postcss/autoprefixer）
- 样式：Tailwind CSS v4 + `tw-animate-css`（不使用 `tailwindcss-animate`）
- 组件：shadcn/ui（Radix UI 原语）+ `class-variance-authority`
- 主题：`next-themes`
- 字体：`@fontsource/ibm-plex-sans`、`@fontsource/ibm-plex-mono`
- 命令面板：`cmdk`
- Toast：`sonner`

禁止引入：
- `tailwindcss-animate`（已被 `tw-animate-css` 替代）
- `postcss` / `autoprefixer`（Tailwind v4 不需要）
- `@vitejs/plugin-react`（使用 swc 版本）
- `@types/react-router-dom`（v7 自带类型）
