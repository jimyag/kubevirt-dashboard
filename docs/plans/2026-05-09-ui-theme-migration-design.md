# kubevirt-dashboard UI 主题迁移方案

> **状态：已被取代。** 本文记录的是 2026-05 将 UI 对齐 kite 风格（Maple Mono 字体、内联组件迁移到 shadcn/ui）的方案，已经实施完毕，随后又被新的设计体系替换：字体改为 IBM Plex Sans / Mono，配色、分区色和共享组件见 `ui/src/index.css`、`ui/src/components/console.tsx`。当前必须遵守的规则以仓库根目录的 [AGENTS.md](../../AGENTS.md) 为准，本文仅作历史参考。

目标：将 `ui/`（kubevirt-dashboard 前端）的视觉风格对齐到 `kite/ui/` 的设计体系。

---

## 现状分析

### kite/ui（目标风格）

| 维度 | 描述 |
|------|------|
| 组件库 | shadcn/ui（new-york 风格） + Radix UI 原语 |
| 色彩系统 | OKLCH 色彩空间 + 多套可切换主题 |
| 字体 | Maple Mono（主字体） + JetBrains Mono（备用等宽字体） |
| 侧边栏 | shadcn/ui SidebarProvider，支持折叠/移动端 |
| 暗色模式 | next-themes 管理，支持 light/dark/system |
| 图标 | lucide-react + @tabler/icons-react |
| 数据表格 | TanStack Table + shadcn/ui Table 组件 |
| Toast | sonner |
| 动画 | tw-animate-css |
| 主题变量 | 包含 sidebar-* 专属 token |

### ui/（当前状态）

| 维度 | 描述 |
|------|------|
| 组件库 | 全部内联手写（Badge、Card、CopyableText 等） |
| 色彩系统 | HSL 静态变量，仅有 light 一套 |
| 字体 | 系统字体 |
| 侧边栏 | 硬编码 `aside` 元素，固定宽度 w-72 |
| 暗色模式 | 无 |
| 图标 | 仅 lucide-react |
| 数据表格 | 原生 HTML table |
| Toast | 无 |
| 代码体量 | 全部逻辑集中在单个 App.tsx（~210 行，含密集内联样式） |

---

## 迁移策略

采用 **渐进式迁移**，按独立阶段执行，每阶段可单独验证，不影响已有功能。

### 阶段 1：设计 Token 与字体（纯 CSS，零破坏性）

文件改动：`ui/src/index.css`

- 将 HSL 色彩变量替换为 OKLCH 变量，对齐 kite 的 `default.css`
- 新增 `dark` 类变量组
- 新增 sidebar-* 专属 token（为阶段 3 做准备）
- 引入 `@font-face`：Maple Mono + JetBrains Mono
  - 字体文件从 `kite/ui/src/assets/fonts/` 复制到 `ui/src/assets/fonts/`
- 替换 `tailwindcss-animate` 为 `tw-animate-css`（kite 的做法）

验证方式：页面颜色整体变为蓝色调 primary，等宽字体生效。

---

### 阶段 2：引入 shadcn/ui 组件库

文件改动：`ui/package.json`、新增 `ui/components.json`、新增 `ui/src/lib/utils.ts`（如不存在）、新增 `ui/src/components/ui/*.tsx`

步骤：
1. 安装依赖：
   ```
   pnpm add class-variance-authority @radix-ui/react-slot
   pnpm add @radix-ui/react-dropdown-menu @radix-ui/react-dialog @radix-ui/react-tabs
   pnpm add @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-tooltip
   pnpm add next-themes sonner @tabler/icons-react
   ```
2. 创建 `components.json`，配置 style=new-york、baseColor=neutral
3. 通过 shadcn CLI 添加组件：
   - `button`、`badge`、`card`、`input`、`select`
   - `table`、`dialog`、`tabs`、`separator`
   - `sidebar`、`dropdown-menu`、`tooltip`、`sonner`

验证方式：`pnpm build` 无报错；各 UI 组件可独立渲染。

---

### 阶段 3：侧边栏重构

文件改动：`ui/src/App.tsx`（Layout 组件）、新建 `ui/src/components/app-sidebar.tsx`

目标：将硬编码 `aside` 替换为 shadcn `SidebarProvider + Sidebar` 体系。

结构对齐：
```
<SidebarProvider>
  <AppSidebar />           // 新建，参考 kite/ui/src/components/app-sidebar.tsx
  <SidebarInset>
    <SiteHeader />         // 新建（面包屑 + 集群选择器）
    <main>{children}</main>
  </SidebarInset>
</SidebarProvider>
```

关键点：
- 保留现有三个导航项（Overview / Machines / Storage）
- 保留集群 context 选择器（移入 SidebarFooter）
- 侧边栏支持折叠（icon-only 模式）和移动端 sheet

验证方式：三个导航项功能正常；侧边栏可折叠；移动端布局不破坏。

---

### 阶段 4：核心组件替换

文件改动：`ui/src/App.tsx`（组件部分）

将内联手写组件替换为 shadcn/ui 对应组件：

| 现有组件 | 替换为 |
|---------|--------|
| 内联 `Badge` | `@/components/ui/badge` |
| 内联 `Card` | `@/components/ui/card` |
| 原生 `<table>` | `@/components/ui/table` |
| 原生 `<input>` / `<select>` | `@/components/ui/input` + `@/components/ui/select` |
| 无 | `<Toaster />` from sonner（全局挂载） |

验证方式：VM 列表、DV 列表、详情页视觉与 kite 主题一致；功能无回归。

---

### 阶段 5：暗色模式与主题切换（可选增强）

文件改动：`ui/src/main.tsx`、`ui/src/App.tsx`（Layout）、`ui/src/components/mode-toggle.tsx`（新建）

步骤：
1. 在 `main.tsx` 用 `<ThemeProvider>` from `next-themes` 包裹应用
2. 新建 `mode-toggle.tsx` 组件（参考 kite 的同名文件）
3. 将 mode-toggle 放入 SiteHeader 右侧

验证方式：切换暗色模式后，页面颜色正确反转；刷新后主题状态持久化。

---

## 执行顺序与风险

```
阶段1（CSS）→ 阶段2（依赖）→ 阶段3（布局）→ 阶段4（组件）→ 阶段5（主题）
```

- 阶段 1-2 可并行，不涉及组件逻辑
- 阶段 3 是破坏性最高的一步（布局重构），务必在 Git 分支上操作
- 阶段 4 建议逐组件替换，每次替换一种组件后验证

风险点：
- `App.tsx` 当前为单文件单体结构，阶段 3-4 改动量大；建议同步拆分为多文件
- xterm / NoVNC 与 shadcn 主题无冲突，但终端区域的背景色需单独保持 `bg-zinc-950`
- 阶段 2 引入 `@radix-ui/*` 后需确认与已有 `@radix-ui/react-dialog` / `@radix-ui/react-tabs` 版本兼容

---

## 文件清单

| 文件路径 | 操作 | 阶段 |
|---------|------|------|
| `ui/src/index.css` | 修改（色彩 token + 字体） | 1 |
| `ui/src/assets/fonts/` | 新建（复制字体文件） | 1 |
| `ui/package.json` | 修改（新增依赖） | 2 |
| `ui/components.json` | 新建 | 2 |
| `ui/src/lib/utils.ts` | 确认/新建 | 2 |
| `ui/src/components/ui/*.tsx` | 新建（shadcn 组件） | 2 |
| `ui/src/components/app-sidebar.tsx` | 新建 | 3 |
| `ui/src/components/site-header.tsx` | 新建 | 3 |
| `ui/src/App.tsx` | 修改（Layout + 组件替换） | 3-4 |
| `ui/src/main.tsx` | 修改（ThemeProvider） | 5 |
| `ui/src/components/mode-toggle.tsx` | 新建 | 5 |

---

## 参考文件（来自 kite/ui）

- 色彩 token：`kite/ui/src/styles/themes/default.css`
- 字体定义：`kite/ui/src/styles/base.css`
- 侧边栏：`kite/ui/src/components/app-sidebar.tsx`
- 页头：`kite/ui/src/components/site-header.tsx`
- 暗色切换：`kite/ui/src/components/mode-toggle.tsx`
- 字体文件：`kite/ui/src/assets/fonts/`
- 组件配置：`kite/ui/components.json`
