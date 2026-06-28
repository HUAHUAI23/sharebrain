# 代码规范

## TypeScript

- 全仓库使用 strict TypeScript。
- 对外边界必须显式导出类型。
- API 入参、AI tool input、数据库派生数据必须有 Zod schema。
- 禁止使用 `any` 绕过约束；确实需要时使用 `unknown` 后缩小类型。
- 捕获异常时按 `unknown` 处理，不假设 Error 类型。

## 命名

- 文件名使用 kebab-case: `document-indexing.ts`。
- React 组件使用 PascalCase。
- Hook 使用 `useXxx`。
- schema 使用 `xxxSchema`，类型使用 `Xxx`。
- 数据库字段在代码中使用 camelCase，数据库列使用 snake_case。

## 模块边界

- `apps/web` 不导入 `packages/db`。
- `apps/collab` 不实现业务 CRUD。
- `apps/worker` 不直接暴露 HTTP API。
- `packages/ui` 不依赖业务包。
- `packages/contracts` 不依赖 app 或 db。

## 错误处理

- API 错误返回 `{ code, message, details? }`。
- 业务错误在 service 层归一化，route 层只映射 HTTP 状态。
- Worker 任务必须记录 job id、输入摘要、失败原因和重试策略。

## 测试

- contract/schema 变更补 Bun 单测。
- API service 变更补 service 和 route 测试。
- Web 关键工作流补 Playwright 或组件级 smoke test。
- Collab 后续接入真实持久化时必须补权限和只读连接测试。
