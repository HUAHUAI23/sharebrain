# ShareBrain

ShareBrain 是面向私有化交付、运维和项目团队的项目周期上下文管理平台。当前仓库阶段只搭建开发体系和应用骨架，不实现业务 CRUD。

## 快速开始

```bash
bun install
bun run typecheck
bun run dev
```

## 应用

- `apps/web`: React、Plate、shadcn/ui、TanStack、Zustand 前端壳层。
- `apps/api`: Hono 主业务 API。
- `apps/collab`: Hocuspocus/Yjs 协作服务。
- `apps/worker`: 后台任务与可选 Mastra workflow 入口。

## 共享包

- `packages/db`: PostgreSQL/Drizzle schema 与数据库入口。
- `packages/contracts`: Zod 合约和跨端类型。
- `packages/ui`: shadcn 风格 UI 组件库与 Notion 风格设计 token。
- `packages/i18n`: 国际化消息、locale 工具。
- `packages/config`: 环境变量 schema 与运行时配置。
- `packages/typescript-config`: TypeScript 基础配置。

## 规范文档

- `docs/architecture.md`
- `docs/project-structure.md`
- `docs/standards/development.md`
- `docs/standards/code-style.md`
- `docs/standards/ui-design.md`
- `docs/standards/ai-development.md`
- `helloagents/`: AI 开发知识库与变更历史。
