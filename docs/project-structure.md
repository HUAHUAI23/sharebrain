# 目录组织规范

## 根目录

```text
apps/
  web/       React + Plate 工作台
  api/       Hono 主业务 API
  collab/    Hocuspocus 协作服务
  worker/    后台任务和 Mastra workflow 入口
packages/
  config/    环境变量 schema 和运行时配置
  contracts/ Zod 合约和跨端类型
  db/        Drizzle schema、client、开发期 push/reset 脚本
  editor/    Plate 编辑器基座（插件 kits、节点 UI、工具栏、静态渲染）
  i18n/      Paraglide 生成消息入口和 locale 工具
  ui/        shadcn 风格 UI 组件库和样式 token
  typescript-config/ 共享 TS 配置
messages/    Paraglide 中文/英文消息源
project.inlang/ Paraglide/inlang 项目配置
docs/
  standards/ 开发、代码、UI、AI 规范
helloagents/
  wiki/      AI 开发知识库
  plan/      待执行方案包
  history/   已执行方案归档
```

## apps/web

```text
src/
  app/        应用根、Provider、路由、全局布局
  components/ 页面级复用组件
  features/   业务特性目录，如 account/storage/modules/dynamic-fields/editor
  lib/        前端工具、client、runtime env
  stores/     Zustand UI 状态
  styles/     app 级样式
```

规则:
- `apps/web/components.json` 只作为 shadcn monorepo app 侧配置，`ui/utils` 指向 `@sharebrain/ui`；基础组件不得生成到 `apps/web/src/components/ui`。
- Web 页面身份以 TanStack Router URL 为事实源，`apps/web/src/app/router.tsx` 维护路由树和 `WorkspaceView` 到 URL 的导航适配；缺少模块上下文的文档入口必须使用显式 `document-lookup` 意图进入 `/documents/:documentId`，不得用空 `moduleId` 伪造文档路由。刷新、前进后退和分享链接不得依赖 React 内存状态或 Zustand。
- feature 内部可拆 `components/queries/mutations/hooks`，跨 feature 复用才上移。
- 服务端状态必须通过 TanStack Query，临时 UI 状态才放 Zustand。
- 登录/注册界面放 `features/auth`，只调用认证 API，不保存明文 token。
- Plate 编辑器基座（插件 kits、节点 UI、工具栏、评论 action/read helper）统一封装在 `packages/editor`；`features/editor` 只保留业务 shell（文档加载/保存、协作接线、Yjs/API/read state adapter）。
- 首页放 `features/home`，项目模块放 `features/project`，账户入口和头像编辑放 `features/account`，空间容量页放 `features/storage`，初始模块配置放 `features/modules`，动态字段控件和默认值解析放 `features/dynamic-fields`。
- 所有已认证页面在右上角复用 `AccountMenu`；菜单只承载身份、空间容量摘要和设置命令，头像裁剪使用独立 Dialog，完整容量明细使用 `/settings/storage` 路由。
- 新项目配置使用 `/settings/new-project` 与 `/settings/new-project/modules/:templateId` 深链接；模块选择由 URL 驱动，字段编辑使用 Sheet，不把列表、详情和复杂字段表单塞进同一滚动面板。
- `features/modules` 中列表容器、模块身份表单和字段 Sheet 分文件维护，API payload types 使用独立 contract 文件；容量格式化等无状态工具放 `features/storage`，账户组件不得成为存储工具依赖源。
- `features/project` 按渲染原型拆分组件，`project-view.tsx` 只保留项目布局和模块选择，collection/timeline/record 文档列表放独立文件。
- timeline 记录创建使用 `RecordComposerSheet`；`NotionCreateRow` 只适合简单对象的新建入口，不承载动态字段复杂表单。
- 正文版本历史产品壳位于 `features/editor/document-version-history*`：queries 只管 sealed list/detail，restore adapter 只管 API operation + stateless ack/status fallback，state reducer 固化列表、内容和 preview/changes 转换；不得把这些业务 DTO 或权限逻辑移入 `packages/editor`。
- 文档活动历史产品壳位于 `features/editor/document-activity-history*` 与 `document-activity-revision.tsx`：queries 管理 sequence 分页和 detail 懒加载，侧栏组合日期/actor/open-sealed/展开摘要，revision 工作区组合 preview/diff/restore；活动 DTO、权限和 tenant/document 上下文不得下沉到 `packages/editor`。

## apps/api

```text
src/
  app/       Hono app、middleware、依赖注入
  config/    API 专属配置
  modules/   按业务模块组织 route/service/repository
```

规则:
- `*.routes.ts` 只处理 HTTP 和 schema 校验。
- `*.service.ts` 处理业务规则。
- `*.repository.ts` 处理数据访问。
- API 不直接导入 web、collab、worker。
- API 通用 auth、错误和依赖注入放 `src/app`。
- 密码认证、session 和 provider 扩展放 `modules/auth`。
- 业务模块按 `modules/<domain>/<domain>.routes.ts` 和 `*.service.ts` 组织。
- 一个 route 文件可按聚合接线多个 service；`modules/modules` 分别使用 `ModuleTemplatesService`、`ProjectModulesService`、`ModuleRecordsService`，共享访问与成员校验 helper，禁止重新合并为全能 service。
- API 集成测试可放在 `modules/*.integration.test.ts`，通过 Hono `app.request()` 覆盖 route/middleware/service 链路。

## apps/collab

```text
src/
  config/      协作服务配置
  extensions/  Hocuspocus extension 和持久化适配器
```

规则:
- 只处理协作同步和权限 gate。
- 文档索引只发 job，不在 WebSocket 链路内做重计算。
- 版本恢复只接受服务端 operationId，在 `Document.saveMutex` 与 restore gate 内执行；collab 不创建业务 operation，持久化失败必须向 Hocuspocus 抛出并关闭对应 room，不能让未落库正文继续编辑。
- 未接入共享 Yjs 同步前，restore 开启时部署副本固定为 1；`COLLAB_REPLICA_COUNT` 只是声明值，发布流程仍需核对平台真实副本数。
- 活动 actor 只能取 `onChange.context` 的认证结果；`onStoreDocument.lastContext` 只负责本轮 snapshot 保存，禁止用于归属防抖窗口内的所有编辑。活动 tracker 使用镜像 Y.Doc，在 actor 边界/store 时投影并通过 begin/commit/rollback drain 与保存事务保持一致。

## apps/worker

```text
src/
  jobs/       后台任务定义
  workflows/  Mastra workflow/agent 编排
```

规则:
- Worker 处理派生数据和 AI 工作流。
- 媒体 GC 跨 tenant 扫描过期上传、孤儿媒体和持久化删除任务；对象存储删除必须使用媒体记录自身的 bucket/key，通过 media 行锁、任务状态、租约恢复和指数退避保证并发安全与可重试，并拒绝无法证明物理释放的版本化 bucket。
- 正文版本空闲封存位于 `jobs/document-version-idle-seal.ts`：默认在最后一次有效正文保存 120 秒后扫描 current open auto，以 document 行锁和锁后二次验证避免与 API/collab 保存竞态；`0` 表示关闭。
- 正文版本 retention 位于 `jobs/document-version-retention.ts`，默认 dry-run；删除必须二次验证保护集合，并在无 version/activity/operation 引用时释放 revision 及 `document_revision` media usage。pending operation expiry 可由 API 状态查询、collab executor 或 Worker 收敛。
- 文档活动空闲封存位于 `jobs/document-activity-idle-seal.ts`：默认空闲 120 秒，以 session partial index 扫描、document 行锁和锁后二次验证把临时 before/after 物化为 revision，原子封存 event/session 并清空临时正文。
- Tool 必须有 Zod input schema、权限上下文、审计和返回大小限制。

## packages

- `contracts` 是跨端类型的唯一来源，禁止在 app 内重复定义接口类型。
- `db` 是数据 schema 的唯一来源。开发阶段只使用 `push/reset/studio`，不生成 migration 文件。
- `db` 的开发期 seed 脚本放在 `packages/db/src/scripts/seed.ts`，不得在 app 启动时自动 seed。
- `i18n` 是前端国际化唯一导入边界；业务组件只从 `@sharebrain/i18n` 导入 `m/getLocale/setLocale`，不直接导入 `src/paraglide` 生成目录。
- 翻译源只维护 `messages/zh-CN.json` 和 `messages/en-US.json`；`packages/i18n/src/paraglide/` 和 `apps/web/src/paraglide/` 是 Paraglide 自动生成物，禁止手改。
- `ui` 只放无业务含义的基础组件和设计 token。
- `editor` 是 Plate 编辑器基座唯一落点：只放无业务含义的插件 kits、节点 UI、工具栏和静态渲染；文案必须走 `@sharebrain/i18n`，基础组件从 `@sharebrain/ui` 引入，不得依赖业务包。
- `editor` 的版本能力只接收和返回 Plate `Value`/渲染 props；禁止定义 documentId、tenant、actor、role、cursor、query 或 restore operation 类型。`VersionDiffKit` 只能用于独立只读 editor，不能加入 `EditorKit`/`BaseEditorKit` 污染正常编辑值。
- `editor` 通过基础 kit 启用稳定 `NodeIdPlugin`，为协作、活动 diff 和宿主扩展提供通用块身份；ID 生成本身不解释活动或版本业务。块级 activity diff、摘要预算和 DTO 放在 `contracts`，会话/持久化放在 `db` 与宿主 app。
- `editor` 内需要业务数据的能力通过 Provider 注入而非写死：媒体上传走 `EditorUploadProvider`（宿主注入 `EditorUploadHandler`，缺省回退本地 object URL），mention 候选走 `EditorMentionProvider`；Web 侧的实现在 `apps/web/src/features/editor/editor-upload.ts`（由 shell 通过 `createEditorUploadHandler({ documentId })` 注入文档上下文，走 `/api/media` 预签名直传，文档内落 `/api/media/:id/raw` 稳定地址）。editor 只把上传返回的 opaque `key` 保存为媒体节点 `sourceKey`，不解释 ShareBrain mediaId。
- 评论线程遵循同一边界：`packages/editor` 只提供 discussion action、未读计算、删除线程 UI、正文 mark 清理和插件状态投影；Web 在 `apps/web/src/features/editor/editor-discussions.ts` 将 action 写入 Yjs `review.discussionsById`，并通过 API 持久化 per-user read state。
- `ui` 是 shadcn 组件唯一落点；`packages/ui/components.json` 使用 `#components/#lib/#hooks` 本地别名，新增 shadcn 组件必须从 `packages/ui` 目录执行 CLI。
- `packages/ui/src/styles/globals.css` 是 Tailwind v4 入口和设计 token 来源；`apps/web/src/styles/app.css` 只保留页面壳、搜索浮层、项目侧栏、业务时间线和 Plate 编辑器排版等跨组件协调样式，普通组件样式优先写在组件 `className`。
- `packages/ui/src/components/ui-provider.tsx` 统一挂载 TooltipProvider 和 Toaster；Web 根部只组合该 Provider，不在 feature 内重复挂基础 UI provider。
- 可跨页面复用且无业务含义的 Notion 风格交互组件放在 `packages/ui`，例如 `notion.tsx` primitives 和 `NotionCreateRow`；app 侧只保留场景布局覆盖。
- `config` 统一校验环境变量，不在 app 中散落读取 `process.env`。
