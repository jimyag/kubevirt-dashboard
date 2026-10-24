# AGENTS.md — kubevirt-dashboard

本文件为 Coding Agent（Claude Code、Codex、Cursor 等）在此仓库工作时提供约束。

---

## 项目结构

```
kubevirt-dashboard/
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

颜色有四种用途，不要用于其他装饰：
- 主色：主操作按钮、选中项、链接悬停
- 状态色：绿 / 琥珀 / 红，只通过 `StatusDot` 等共享组件使用
- 分区色：每个导航分区一个色相，由 `ui/src/index.css` 中的 `--tone-*` token 定义（同一亮度与彩度，色相在主色附近的冷色区间：Networking 190、Storage 222、Compute 255、Platform 285、Security 315），通过 `ui/src/lib/navigation.ts` 的 `toneClasses` 使用（`text-tone-*` / `bg-tone-*`），用于侧边栏图标、面包屑、页面标题图标和总览指标；不要改用 Tailwind 调色板颜色，新增分区时保持相同亮度与彩度
- 代码高亮：只用于 YAML 清单查看 / 编辑器（`components/yaml-editor.tsx`），通过 `--code-key`、`--code-string`、`--code-literal`、`--code-comment`（`text-code-*`）使用

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
- 导航分两级：分区 → 页面，或分区 → 分组 → 页面（`NavItem.children`）。一个资源有多个子资源 / 关联资源时（如 VPC 下的子网、路由表、对等连接）放进同一分组；分组名不要与其中的页面同名；只剩一个可见页面的分组会自动展开为该页面

### 4. 设计模式

- 页面结构：`PageHeader`（标题 `text-xl font-semibold` + 右侧操作）→ 可选 Tab → `Toolbar` → `DataTable` / `Panel`
- 文案克制：副标题只写事实（例如资源 Kind / API），不写解释性句子；空状态只写一句结论，不写引导语
- 不使用装饰性元素：不加入场动画、脉冲 / ping 动画、渐变、彩色图标底块；一个页面里不要堆叠大量小卡片
- 列表：名称列用 `Link` + `font-medium hover:text-primary`，命名空间等次要信息放在名称下方的 `text-xs text-muted-foreground`
- 详情：优先用一个分栏汇总卡片 + `KeyValueGrid`，避免大量零散小卡片
- 选择型输入（规格、镜像、引擎等）使用 `ChoiceCard`，而不是长下拉框
- IP、CIDR、ID、Kind、apiVersion 等技术值使用 `font-mono`
- 时间统一显示相对时间（`relativeTime`），完整时间放在 `title` 里
- 删除操作必须经过 `ConfirmDialog` 确认；其他会立即修改集群的操作（开关机、保存规则、解绑等）同样先用 `ConfirmDialog` 二次确认，带表单和预览的对话框本身即视为确认
- 清单页统一用 `components/manifest.tsx` 的 `ManifestPanel`：`kubectl get -o yaml` 格式、高亮、编辑，保存前展示 diff 并确认，用 PUT 携带 `resourceVersion` 防止覆盖他人修改

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

---

## 回归中已确认的问题与约束

以下问题来自多节点 kind 环境的真实回归。修改相关逻辑前先阅读对应实现和测试；新增实现应避免重新引入这些问题。

### 1. Schema 驱动资源管理

- CRD 的展示版本、实际 served API、CRD schema 版本和资源路径可能不同。Calico 的 list API 使用 `projectcalico.org/v3`，schema 却来自 `crd.projectcalico.org/v1`；不能假定三者相同。发现 CRD 时必须按 group、plural 和全部候选 version 校验，最终以 discovery 返回的 served API、Kind、scope 和 verbs 为准。
- CRD 的复数名可能与资源 id 不同，旧版自定义 builder 也可能使用过时路径或模板。schema 可用时使用 live OpenAPI schema，不从旧模板推断字段；schema 不可用时明确降级，不能静默提交一个被 API 裁剪掉字段的对象。
- 服务端没有按预期应用字段时，不能把请求成功当成功能成功。回归要读回 API 对象；必要时用 dry-run、实际流量或控制器状态确认字段语义。
- Kubernetes 可能裁剪 fixture CRD 中的 `readOnly`，所以单元测试不能代替真实 CRD 的保存与回读。实现必须覆盖真实 schema，测试则覆盖嵌套对象、数组和 map 中 `false`、`0`、空字符串和 `null` 等易丢失值。
- `readOnly` 和不可变字段必须递归保护。祖先对象或数组的删除操作不能绕过后代只读字段；已有资源的 immutable 字段只读，创建新资源时仍可编辑。只识别明确的 `self == oldSelf`（含 `allOf`）约束，其他 CEL 交给 API server 判断。
- 通用表单必须保留用户未触碰的字段和未知扩展字段，不能把对象按当前 schema 重建。空值、默认值和未设置状态要区分，不能把合法 `false`、`0`、`""` 当作缺失。
- 编辑已有资源必须带最新 `resourceVersion`。控制器更新产生 409 时保留本地草稿、展示冲突并允许基于最新对象重试；不能覆盖并发更新。
- CRD 页面要使用实际 served versions。URL 版本、版本选择器、API 路径、schema 和资源身份必须一致；切换版本时保留合法的 namespace/name 和当前视图。
- 元数据与 spec 在同一编辑器展示。labels 和 annotations 使用逐条 key/value 编辑，支持单独增加、重命名和删除，不提供整块一次性文本编辑。
- 嵌套对象使用清晰分区或可折叠摘要，数组默认收起并显示有意义的摘要；不能长期把整棵嵌套对象平铺成难以阅读的输入树。
- 列表优先使用 CRD printer columns，同时请求完整对象用于编辑。schema 字段名、API version、Kind、IP、CIDR 和 ID 等技术值保留原文，不翻译。
- 复杂 CEL、webhook、聚合 API 和控制器特有规则以服务端为准。前端只做能由 schema 明确证明的校验；无法证明的约束不应在客户端伪造。

### 2. 通用编辑与显示

- Kubernetes 的 `IntOrString`、quantity、percentage 和带引号数字不能只按 JS 类型推断。字符串 `"80"` 必须保持字符串，numeric `80` 必须保持数字；quantity 和原始字节值只在展示层格式化，提交时继续使用 API 原值。
- 空字符串、多行文本、前后空格和字面引号都是有效数据。键值序列化必须无损，不能用 `||` 或真值判断误删合法空值。
- replica 等数值字段接受 `0`；不要用 `Number(value) || 1` 之类逻辑。数值、百分比字符串和枚举要按各自 schema 序列化。
- Service 等有类型分支的资源要显示与类型对应的字段，并在切换类型时清理不再适用的字段。ExternalName 必须提供 `externalName`，不能只切换 `type`。
- 状态显示要区分 Ready、Pending、Terminating、Failed 和 `No data`。存在 `deletionTimestamp` 时优先显示 Terminating；布尔 readiness 必须正确区分 `true` 和 `false`，不能把对象或条件数组直接渲染成 `[object Object]`。
- 数组中的对象不能因为含 `type` 字段就被当作 condition。条件识别至少要求有 status/condition 语义，避免误用 condition 布局。
- 长 URL、错误文本、注解、清单和终端内容必须换行或内部滚动。确认对话框固定底部操作区，正文独立滚动，任何 viewport 都不能把确认按钮挤出可操作范围。
- 异步写操作完成后，状态可能仍处于 Terminating/Pending。相关列表和详情要用现有 visibility-aware polling 或 Refresh 收敛，并展示加载错误；测试必须等待目标状态，不能因立即读到的旧状态判失败或通过。

### 3. 网络、存储与虚拟机语义

- NetworkPolicy、Calico/Cilium policy、安全组和 QoS 的 API 对象存在不等于规则生效。至少验证控制器状态或数据面，再分别用允许和拒绝场景确认行为。
- 控制器状态可能是布尔值、condition 数组或嵌套状态，页面要优先使用真实 Ready condition，并保留原始状态用于颜色判断。
- 修改网络对象时只改目标字段，保留无关的 provider、security group、port security 和 launcher-template 字段。删除一个 secondary interface 不能清掉其他接口仍在使用的主网络或安全组配置。
- Kube-OVN reserved IP 的 namespace 范围不能只放在展示用字段。必须核对 Vip、AllowedAddressPair 和 VM 实际网络配置，避免同一个 IP/MAC 生成冲突端口。
- NAT、安全组、绑定和 DataVolume 等异步资源要验证最终 API 状态以及实际连通性/存储状态。无法由 Dashboard 修复的上游 controller 限制要明确记录为环境或控制器限制。
- QoS 校验应覆盖未限速、限速和清除限制；容量展示应覆盖 raw bytes 与 Kubernetes quantity，且展示格式化不能污染 Resize 等写操作。
- VM 的 metadata 编辑不能重建 spec。编辑 object labels/annotations 时，launcher template、网络和安全组字段必须原样保留；涉及运行时字段时，从 live VMI 读取当前状态。
- VNC、Serial、Logs、Shell 在 rollout、Pod 重建或节点失联后会断线。界面要提供明确错误和重试/重连入口；Retry 成功只能证明恢复连接，不能据此声称 guest 内操作已执行。
- Guest agent 指标、Ctrl+Alt+Del 重启和驱动特定性能需要相应 guest 或硬件能力。环境不具备时显示 `No data` 或能力限制，不从缺失数据推断零使用量。

### 4. 多环境与故障验证

- kind/Docker 只能证明控制面、API 和容器网络行为。物理 NIC、VLAN 上行、EVPN/BFD、完整节点故障矩阵和真实存储驱动性能不能由 kind 结果推断。
- 在测试 KubeVirt、Multus、CNI 或 CSI 时，先检查节点资源压力和组件状态。多 Pod 并发启动可能导致 Multus OOM 或镜像拉取超时；只调整隔离测试环境所需的明确参数，并记录恢复前后的值。
- 节点失联后要区分 NotReady、toleration 到期、launcher Pod 重建、VMI 迁移和流量恢复，不能用单个 Ready 字段代替整个恢复链。
- 强制删除 Dashboard Pod 后，等待 replacement Ready、Deployment Available 和 Service/local endpoint 恢复；仅看到新 Pod 创建不算通过。
- 缩容 CSI provider 后，分别验证已有卷读取、新卷 Pending/Unschedulable、恢复后 Bound/Succeeded；不能只验证 Pod 状态。
- APF、控制器和网络故障测试应使用隔离、可清理的对象，并记录队列拒绝、重试、健康检查和恢复证据。清理后再次确认没有残留测试资源。
- 浏览器回归必须等待页面标题或目标控件出现再判定。快速切换路由时，上一请求的 `Failed to fetch` 可能来自页面卸载、port-forward 重连或 rollout，不能直接算作页面故障；在稳定页面重放后才能定性。
- 页面巡检至少记录 path、目标 heading、可见 alert、是否为空和耗时。CRD 巡检要实际打开 Create，检查 Metadata、Resource fields 和 Review changes，再取消；只检查列表或按钮存在不算表单覆盖。
- Radix/shadcn 的 Combobox、Tabs、Dialog 不能用原生 select/click 假设操作。浏览器测试按角色、名称和可见状态定位，版本切换要核对 URL 和 API version selector 一致。
- 故障切换和控制器测试完成后清理自己创建的 fixture、临时网络、临时文件、转发和进程，并复核共享集群中不属于本任务的资源未被修改。

### 5. 部署与验证证据

- 区分源码 HEAD、镜像 tag、镜像内容、Helm revision 和实际运行 Pod。镜像可能在某个未提交修复期间构建；报告必须说明 tag 前缀与镜像内容的真实关系，不能只凭 tag 判断包含哪些代码。
- 部署后核对目标集群/context、Helm release 状态、Deployment image、Pod readiness 和本地入口 HTTP 状态。多环境部署逐个确认，不能用一套环境的成功代替其他环境。
- port-forward 或 SSH tunnel 断开不等于 Dashboard 故障。先分别检查远端 Service、Pod 和本地入口，再重建转发并复验；保留用户正在使用的入口。
- 行为改动优先执行对应的 Bun 测试、lint、build 和真实浏览器/API 复验。声明式配置使用现有渲染、校验或 dry-run，不新增只复述配置的测试。最终再执行 `git diff --check`。
- 报告只把实际执行并观察到的结果写成通过。未覆盖的字段组合、物理数据面、Guest Agent 能力和兼容矩阵要明确列为限制；一次 APF queue-full 不能代表完整负载测试。
