# 资源管理侧边栏与应用管理设计

状态：已在本地实现；`lint`、UI 测试、构建和 Helm Go 测试通过。浏览器已验证导航层级、收起侧栏、命令面板、资源作用域切换及应用管理流程，并在测试集群读取应用页面；完整资源 CRUD、认证仓库、OCI 下载、Pod 重建持久性、多副本并发和生产行为尚未验证。

源码基线：`4c7d52b8c8a8d899af4c191137763914b7373453`。

## 组织方式

资源管理通过侧边栏直接进入。虚拟机相关资源集中在“虚拟机”，容器工作负载、通用网络、通用存储和集群资源各有入口。应用安装与运行实例管理集中在“应用”。

菜单最多三级：一级为分区标题，二级为资源页面或可折叠分组，三级为分组内的资源页面。只有一个可见页面的分组直接展开为二级页面；没有可见页面的分组隐藏。页面内的作用域、版本和详情 Tab 不计入菜单层级。

沿用现有字体、语义颜色、分区色和共享组件。菜单名称在代码中使用英文 key 和 Kubernetes 资源标题；简体中文界面统一显示“中文名（Kind 或常用简称）”，英文界面保留英文原名称。分组名称和操作文案继续使用普通界面翻译，避免正文中的 `Pods`、`Services` 等词也被强制追加 Kind。

## 菜单分类

```text
总览
├─ 集群概览
└─ 事件

虚拟机
├─ 实例与运行
│  ├─ 虚拟机（VM）
│  ├─ 虚拟机实例（VMI）
│  ├─ 虚拟机池（VM Pool）
│  ├─ 虚拟机实例副本集（VMIRS）
│  └─ 虚拟机实例迁移（VMIM）
├─ 镜像与磁盘
│  ├─ 镜像数据源（DataSource）
│  ├─ 数据卷（DataVolume）
│  └─ 定时导入（DataImportCron）
├─ 快照与恢复
│  ├─ 虚拟机快照（VirtualMachineSnapshot）
│  ├─ 虚拟机恢复（VirtualMachineRestore）
│  └─ 虚拟机快照内容（VirtualMachineSnapshotContent）
├─ 规格与偏好
│  ├─ 实例规格（Instancetype）
│  └─ 实例偏好（Preference）
├─ SSH 密钥（Secret）
└─ 高级配置
   ├─ KubeVirt 安装（KubeVirt）
   ├─ 存储配置（StorageProfile）
   ├─ 导入源（VolumeImportSource）
   ├─ 上传源（VolumeUploadSource）
   ├─ 克隆源（VolumeCloneSource）
   └─ 对象传输（ObjectTransfer）

容器工作负载
├─ 容器组（Pod）
├─ 无状态负载（Deployment）
├─ 有状态负载（StatefulSet）
├─ 守护进程集（DaemonSet）
├─ 批处理
│  ├─ 任务（Job）
│  └─ 定时任务（CronJob）
├─ 自动伸缩（HPA）
└─ 高级资源
   ├─ 副本集（ReplicaSet）
   ├─ 复制控制器（ReplicationController）
   ├─ Pod 模板（PodTemplate）
   └─ 控制器修订（ControllerRevision）

应用
├─ 应用目录
├─ 已安装应用
└─ 应用仓库

网络
├─ 服务与发现
│  ├─ 服务（Service）
│  ├─ 端点切片（EndpointSlice）
│  └─ 端点（Endpoints）
├─ 入口与路由
│  ├─ 入口（Ingress）
│  ├─ 入口类（IngressClass）
│  ├─ 网关（Gateway）
│  ├─ 网关类（GatewayClass）
│  └─ HTTP 路由（HTTPRoute）
├─ 虚拟私有网络
│  ├─ 虚拟私有云（VPC）
│  ├─ 子网（Subnet）
│  ├─ 路由表（RouteTable）
│  ├─ 对等连接（VPC Peering）
│  ├─ IP 池（IPPool）
│  └─ 预留 IP（Vip）
├─ 公网与 NAT
│  ├─ 弹性 IP（EIP）
│  ├─ NAT 网关（VpcNatGateway）
│  ├─ SNAT 规则（SNAT）
│  ├─ DNAT 规则（DNAT）
│  └─ 浮动 IP（FIP）
├─ 网络策略
│  ├─ 网络策略（NetworkPolicy）
│  ├─ 安全组（SecurityGroup）
│  └─ 地址组（CiliumCIDRGroup）
├─ 网络附加定义（NetworkAttachmentDefinition）
└─ 网络扩展
   ├─ Calico
   ├─ Cilium
   ├─ Kube-OVN
   └─ Envoy Gateway

存储
├─ 持久卷声明（PVC）
├─ 持久卷（PV）
├─ 存储配置
│  ├─ 存储类（StorageClass）
│  └─ 卷属性类（VolumeAttributesClass）
├─ 卷快照
│  ├─ 卷快照（VolumeSnapshot）
│  ├─ 卷快照内容（VolumeSnapshotContent）
│  └─ 卷快照类（VolumeSnapshotClass）
└─ CSI
   ├─ CSI 驱动（CSIDriver）
   ├─ CSI 节点（CSINode）
   ├─ CSI 存储容量（CSIStorageCapacity）
   └─ 卷挂载（VolumeAttachment）

配置与安全
├─ 配置项（ConfigMap）
├─ 保密字典（Secret）
├─ 身份与权限
│  ├─ 服务账号（ServiceAccount）
│  ├─ 角色（Role）
│  ├─ 角色绑定（RoleBinding）
│  ├─ 集群角色（ClusterRole）
│  └─ 集群角色绑定（ClusterRoleBinding）
├─ 资源约束
│  ├─ 资源配额（ResourceQuota）
│  ├─ 资源限制范围（LimitRange）
│  └─ Pod 中断预算（PDB）
├─ 准入控制
│  ├─ 变更准入 Webhook（MutatingWebhookConfiguration）
│  ├─ 校验准入 Webhook（ValidatingWebhookConfiguration）
│  ├─ 校验准入策略（ValidatingAdmissionPolicy）
│  └─ 校验准入策略绑定（ValidatingAdmissionPolicyBinding）
└─ 证书签名请求（CSR）

集群
├─ 节点（Node）
├─ 命名空间（Namespace）
├─ 调度与运行时
│  ├─ 优先级类（PriorityClass）
│  └─ 运行时类（RuntimeClass）
├─ API 与扩展
│  ├─ 自定义资源定义（CRD）
│  ├─ 自定义资源（Custom resources）
│  └─ API 服务（APIService）
├─ API 流量控制
│  ├─ 流控模式（FlowSchema）
│  └─ 优先级配置（PriorityLevelConfiguration）
└─ 控制面
   ├─ 租约（Lease）
   └─ 组件状态（ComponentStatus）

设置
├─ 通用设置
└─ 监控设置
```

网络扩展下的 Calico、Cilium 和 Kube-OVN 在侧边栏展开为二级供应商节点和三级资源菜单，直接进入已有资源页面。各供应商按策略、IPAM、BGP、端点、路由和运行时等用途分组；单页面分组直接显示页面。即使目标集群只提供其中一个供应商，“网络扩展”外层仍保留，避免供应商安装状态改变菜单语义。Envoy Gateway 的 CRD 集合随安装版本变化，在 discovery 完成后按该 API group 实际 served resources 动态生成页面，避免把版本相关资源静态固化；discovery 完成前保留其目录入口。分类页面仍保留，作为搜索和补充浏览入口。

## 虚拟机资源归属

实例规格和实例偏好使用项目已有的 KubeVirt 资源：

| 页面 | 集群级资源 | 命名空间级资源 |
| --- | --- | --- |
| 实例规格 | VirtualMachineClusterInstancetype | VirtualMachineInstancetype |
| 实例偏好 | VirtualMachineClusterPreference | VirtualMachinePreference |

两页均提供作用域切换，选择命名空间级时展示 namespace 筛选。作用域切换保留相应资源身份和可用的页面状态，资源请求使用实际 Kind、scope 和 served API。

虚拟机镜像、DataVolume、虚拟机快照、恢复和 CDI 配置放在“虚拟机”。通用 PVC、PV、StorageClass、CSI 和卷快照放在“存储”；虚拟机详情提供关联资源入口。SSH 密钥保留为带用途筛选的 Secret 视图，“配置与安全”下的 Secrets 展示通用 Secret，二者不合并成同一个列表。

HPA 是通用自动伸缩资源，统一入口放在“容器工作负载”。实例池详情提供跳转到相关 HPA 的入口，保留对虚拟机实例池的伸缩配置能力。

## 应用管理

“应用”包含三个页面，分别管理可安装的 Chart、集群内的 Release 和 Chart 来源。

| 页面 | 展示内容 | 主要操作 |
| --- | --- | --- |
| 应用目录 | Chart 名称、说明、来源、可选版本、默认配置 | 搜索、查看详情、选择版本安装 |
| 已安装应用 | Release 名称、namespace、Chart 版本、应用版本、Helm 状态 | 查看运行资源、编辑配置、升级、回滚、卸载 |
| 应用仓库 | 仓库名称、地址、类型、连接状态、同步结果 | 添加、编辑、检查连接、同步、移除 |

安装入口位于应用目录。安装时选择版本，填写 Release 名称、namespace 和配置，并在提交前确认。安装完成后进入对应的已安装应用详情。

已安装应用详情使用页面内 Tab 展示运行资源、用户配置、默认配置、Manifest、历史和说明。升级与回滚位于详情操作区，历史页选择目标 revision 后确认回滚。Chart 版本、应用版本和 Release revision 分别展示，避免混用。

Helm 状态和关联资源的运行状态分别呈现。Release 为 deployed 只能说明 Helm 发布状态，不能替代 Deployment、Pod 或其他资源的就绪状态。

HTTP Chart 仓库与 OCI 来源分别处理。OCI 来源支持通过明确的 Chart 引用安装；目录能否枚举 Chart 和版本取决于来源提供的能力，不能假定所有 OCI 来源都支持完整浏览。无法枚举时展示能力说明，保留明确引用的安装入口。

应用目录、已安装应用和应用仓库页面均已接入。应用目录可浏览已保存 HTTP 仓库的 Chart；OCI 来源按 Chart 引用安装。已安装应用保留 Release 列表、安装、详情、配置修改、升级、回滚、卸载，以及运行资源、历史和 Manifest 展示。仓库配置按集群 API endpoint 隔离，HTTP 和 OCI 凭据只保存在后端配置中；单个仓库刷新失败会保留其他仓库结果并显示错误。后端配置当前存放在单实例本地目录，多副本共享持久化和 Pod 重建后的保留尚未验证。

## 可补充的 Kubernetes 资源

以下资源可在后续按目标集群 discovery 的结果补充入口。菜单不静态假定它们存在；API 未提供、功能门未开启或权限不可见时隐藏对应入口，不能把 discovery 失败解释为资源不存在。

| 分类 | Kind | 建议 |
| --- | --- | --- |
| Services 地址分配 | ServiceCIDR、IPAddress | 放入“网络 → 服务与发现”。适合查看 Service 地址池和分配关系；IPAddress 默认只读。 |
| 准入控制 | MutatingAdmissionPolicy、MutatingAdmissionPolicyBinding | 放入“配置与安全 → 准入控制”，补齐变更策略与已有 ValidatingAdmissionPolicy 的对称视图。 |
| 设备资源 | DeviceClass、ResourceClaim、ResourceClaimTemplate、ResourceSlice | 新增“容器工作负载 → 设备资源”。ResourceClaim 和 ResourceClaimTemplate 为命名空间级，其余为集群级；ResourceSlice 由驱动维护，默认只读。 |
| 设备资源 | DeviceTaintRule | 与设备资源同组，适合集群管理员诊断设备可用性。 |
| 设备资源 | ResourcePoolStatusRequest | 低优先级；这是按需生成的一次性状态请求，不应设计成持续刷新对象。 |
| 证书与信任 | ClusterTrustBundle、PodCertificateRequest | 放入“配置与安全”，与 CertificateSigningRequests 邻近；PodCertificateRequest 侧重状态及关联 Pod。 |
| 协同选主 | LeaseCandidate | 放入“集群 → 控制面”，放在 Leases 旁，用于诊断选主。 |
| 存储维护 | StorageVersionMigration、StorageVersion | 新增“存储 → 存储维护”。StorageVersion 默认只读；迁移会重写存储对象，需要独立确认和能力校验。 |
| 调度协同 | Workload、PodGroup、CompositePodGroup | 新增条件可见的“容器工作负载 → 调度协同”，用于 gang scheduling 和分层调度。不能与同名 CRD 混为一谈。 |

这些资源跨越多个 Kubernetes 版本和功能门。ServiceCIDR、IPAddress、DRA 资源、准入变更策略、集群信任包、PodCertificateRequest、LeaseCandidate 和 StorageVersionMigration 可优先接入；StorageVersion、Workload、PodGroup、CompositePodGroup、DeviceTaintRule 和 ResourcePoolStatusRequest 应按目标版本能力后置。现有通用 discovery、动态 schema 和 API 代理足以接入它们，不应为了新增 Kind 扩大静态类型层；只有当前 Go SDK 没有对应 typed client 时才改用已有的动态路径。

## 导航与兼容

菜单数据继续集中在 `ui/src/lib/navigation.ts`，供侧边栏、面包屑和命令面板使用。一级分区、供应商分组和资源页面沿用现有 `NavSection` 与 `NavItem.children` 结构。当前侧边栏视觉深度为三级：网络扩展下的供应商是二级节点，供应商内的用途分组和资源页面都在三级层展示，不再增加第四级视觉缩进。资源叶子通过路径关联 `ResourceConfig`，其显示名称由同一资源标签函数生成；动态 Envoy Gateway CRD 在能匹配 Kind 时也使用该规则，未知 Kind 保持 API discovery 返回的原文。

重组菜单保留现有资源 URL、请求路径和操作语义。目录页继续可访问，作为补充浏览入口；主要资源通过侧边栏直接进入。实例规格和实例偏好的作用域切换应兼容已有集群级与命名空间级链接。

当前页面对应的父分组自动展开，面包屑完整显示所属分区、分组和页面。侧栏收起为图标时，分组入口指向第一个可见页面。侧栏、面包屑、资源目录、列表页标题、详情面包屑和命令面板共用资源标签，中文名称不会在不同入口间漂移；命令面板同时匹配英文 Kind、中文名称和所属分组。

菜单按当前集群实际提供的 API 和现有网络能力过滤。发现失败时显示失败状态与重试入口，不能将失败当成 API 未提供；菜单可见性不能代替资源请求的权限检查。

虚拟机与容器工作负载复用 compute 分区色，应用、集群与设置复用 platform 分区色；网络、存储和配置与安全分别沿用对应的语义分区色。

在测试集群 `jfcs-qa1` 上，discovery 只返回 Calico 相关 API；Cilium、Kube-OVN 和 Envoy Gateway 被隐藏。真实浏览器已验证“网络扩展 → Calico → Policy → Calico Network Policies”的展开和跳转，资源链接保持选中，面包屑包含完整祖先，控制台无页面异常。中文界面的 PVC、StorageClass 和 Namespace 在侧栏、面包屑和页面标题中分别显示为“持久卷声明（PVC）”“存储类（StorageClass）”和“命名空间（Namespace）”，首页事件显示“事件（Event）”；切回英文后恢复 Kubernetes 原名称。命令面板可以用 `PersistentVolumeClaims` 和“持久卷声明”找到 PVC。Cilium、Kube-OVN 和 Envoy Gateway 未安装，其菜单生成由测试覆盖，完整集群页面未复验。

## 实施触点与验收

现有主要实现位置：

- `ui/src/lib/navigation.ts`：导航配置、API 可见性和路径匹配。
- `ui/src/components/app-sidebar.tsx`：分区、分组折叠、选中状态和图标模式。
- `ui/src/components/site-header.tsx`：面包屑。
- `ui/src/components/command-palette.tsx`：页面搜索与跳转。
- `ui/src/resources/group-pages.tsx`：资源分类与可用资源列表。
- `ui/src/components/resource-management.tsx`：通用资源列表、详情、事件和 Manifest 展示。
- `ui/src/pages/custom-resources.tsx`：按 discovery 生成的动态 CRD 页面。
- `ui/src/App.tsx`：现有资源和分类路由。
- `ui/src/lib/locales/zh.ts`：普通界面翻译与资源标题标签。
- `ui/src/pages/helm.tsx`、`internal/helm/helm.go`：现有应用安装与 Release 管理。

实施后检查以下可观察行为：

- 虚拟机专用资源均能从“虚拟机”进入，通用存储和网络资源保留独立入口。
- 实例规格与实例偏好均可切换集群级、命名空间级，旧链接可继续打开。
- 菜单最多三级；空分组隐藏，单页面分组自动展开为页面。
- 资源列表、详情、事件和 Manifest 页面均能选中正确菜单并展开对应分组。
- 面包屑、命令面板与侧栏名称和跳转目标一致。
- 已提供、未提供和发现失败的 API 不混为同一状态，重试后能更新可见入口。
- 桌面展开、图标模式、窄屏和键盘操作均能访问目标页面，长名称不会遮挡操作。
- 中文、英文和明暗主题均沿用现有设计规范。
- 应用目录安装与已安装应用升级、回滚、卸载分别验证，操作保留确认与错误反馈。
- 重组菜单不改变原有集群写操作，不新增重复的资源维护逻辑。

本文件记录本地实现和设计。浏览器已验证导航、作用域切换、中英文资源标签、命令面板中英文搜索和应用管理流程，测试集群已读取应用页面。完整资源 CRUD、私有 HTTP/OCI 仓库认证与 OCI 下载、仓库配置在 Pod 重建后的持久性、多副本并发和生产行为尚未验证；这些结果不能由单元测试、lint 或构建代替。
