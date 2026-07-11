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

## apps/worker

```text
src/
  jobs/       后台任务定义
  workflows/  Mastra workflow/agent 编排
```

规则:
- Worker 处理派生数据和 AI 工作流。
- 媒体 GC 跨 tenant 扫描过期上传、孤儿媒体和持久化删除任务；对象存储删除必须使用媒体记录自身的 bucket/key，通过 media 行锁、任务状态、租约恢复和指数退避保证并发安全与可重试，并拒绝无法证明物理释放的版本化 bucket。
- Tool 必须有 Zod input schema、权限上下文、审计和返回大小限制。

## packages

- `contracts` 是跨端类型的唯一来源，禁止在 app 内重复定义接口类型。
- `db` 是数据 schema 的唯一来源。开发阶段只使用 `push/reset/studio`，不生成 migration 文件。
- `db` 的开发期 seed 脚本放在 `packages/db/src/scripts/seed.ts`，不得在 app 启动时自动 seed。
- `i18n` 是前端国际化唯一导入边界；业务组件只从 `@sharebrain/i18n` 导入 `m/getLocale/setLocale`，不直接导入 `src/paraglide` 生成目录。
- 翻译源只维护 `messages/zh-CN.json` 和 `messages/en-US.json`；`packages/i18n/src/paraglide/` 和 `apps/web/src/paraglide/` 是 Paraglide 自动生成物，禁止手改。
- `ui` 只放无业务含义的基础组件和设计 token。
- `editor` 是 Plate 编辑器基座唯一落点：只放无业务含义的插件 kits、节点 UI、工具栏和静态渲染；文案必须走 `@sharebrain/i18n`，基础组件从 `@sharebrain/ui` 引入，不得依赖业务包。
- `editor` 内需要业务数据的能力通过 Provider 注入而非写死：媒体上传走 `EditorUploadProvider`（宿主注入 `EditorUploadHandler`，缺省回退本地 object URL），mention 候选走 `EditorMentionProvider`；Web 侧的实现在 `apps/web/src/features/editor/editor-upload.ts`（由 shell 通过 `createEditorUploadHandler({ documentId })` 注入文档上下文，走 `/api/media` 预签名直传，文档内落 `/api/media/:id/raw` 稳定地址）。editor 只把上传返回的 opaque `key` 保存为媒体节点 `sourceKey`，不解释 ShareBrain mediaId。
- 评论线程遵循同一边界：`packages/editor` 只提供 discussion action、未读计算、删除线程 UI、正文 mark 清理和插件状态投影；Web 在 `apps/web/src/features/editor/editor-discussions.ts` 将 action 写入 Yjs `review.discussionsById`，并通过 API 持久化 per-user read state。
- `ui` 是 shadcn 组件唯一落点；`packages/ui/components.json` 使用 `#components/#lib/#hooks` 本地别名，新增 shadcn 组件必须从 `packages/ui` 目录执行 CLI。
- `packages/ui/src/styles/globals.css` 是 Tailwind v4 入口和设计 token 来源；`apps/web/src/styles/app.css` 只保留页面壳、搜索浮层、项目侧栏、业务时间线和 Plate 编辑器排版等跨组件协调样式，普通组件样式优先写在组件 `className`。
- `packages/ui/src/components/ui-provider.tsx` 统一挂载 TooltipProvider 和 Toaster；Web 根部只组合该 Provider，不在 feature 内重复挂基础 UI provider。
- 可跨页面复用且无业务含义的 Notion 风格交互组件放在 `packages/ui`，例如 `notion.tsx` primitives 和 `NotionCreateRow`；app 侧只保留场景布局覆盖。
- `config` 统一校验环境变量，不在 app 中散落读取 `process.env`。
