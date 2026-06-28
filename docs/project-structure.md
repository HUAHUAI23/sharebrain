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
  i18n/      国际化消息和 locale 工具
  ui/        shadcn 风格 UI 组件库和样式 token
  typescript-config/ 共享 TS 配置
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
  features/   业务特性目录，如 editor/search/timeline
  lib/        前端工具、client、runtime env
  stores/     Zustand UI 状态
  styles/     app 级样式
```

规则:
- feature 内部可拆 `components/queries/mutations/hooks`，跨 feature 复用才上移。
- 服务端状态必须通过 TanStack Query，临时 UI 状态才放 Zustand。
- Plate 编辑器相关代码统一放 `features/editor`。

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
- Tool 必须有 Zod input schema、权限上下文、审计和返回大小限制。

## packages

- `contracts` 是跨端类型的唯一来源，禁止在 app 内重复定义接口类型。
- `db` 是数据 schema 的唯一来源。开发阶段只使用 `push/reset/studio`，不生成 migration 文件。
- `ui` 只放无业务含义的基础组件和设计 token。
- `config` 统一校验环境变量，不在 app 中散落读取 `process.env`。
