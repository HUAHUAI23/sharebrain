# 项目技术约定

## 技术栈

- **运行时:** Bun 1.3.11，Node 24+ 仅作为工具兼容层。
- **Monorepo:** Bun workspaces + catalog，Turborepo。
- **前端:** React 19、Vite 8、Plate 53、Tailwind v4、shadcn/ui、TanStack Query/Router/Table/Form、Zustand。
- **API:** Hono、Zod、OpenAPIHono。
- **协作:** Hocuspocus、Yjs。
- **数据:** PostgreSQL、Drizzle ORM。
- **Worker/AI:** Bun worker、Vercel AI SDK、可选 Mastra。

## 开发约定

- 第三方依赖统一写在根 `package.json` 的 `workspaces.catalog`，默认使用 npm latest。
- app/package 内使用 `catalog:` 或 `workspace:*`。
- TypeScript strict，不允许业务边界出现未校验输入。
- 所有 API、AI tool、跨端类型必须从 `packages/contracts` 导出。
- 数据 schema 只能从 `packages/db` 维护。
- UI 组件只能从 `packages/ui` 抽象无业务组件。

## 错误与日志

- API 错误格式为 `{ code, message, details? }`。
- Worker 必须记录 job id、输入摘要、失败原因、重试策略。
- AI 调用必须记录 request id、用户、项目、用途和 token 预算。

## 测试与流程

- 基础验证: `bun run typecheck`。
- 完整验证: `bun run check`。
- 开发阶段数据库变更后运行 `bun run db:push`；需要重建库时运行 `bun run db:reset:push`。
- 完成架构或规范变更必须同步 `docs/` 和 `helloagents/wiki/`。
