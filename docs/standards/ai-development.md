# AI 开发规范

## AI 功能边界

AI 分为两类:

- 文档内实时 AI: 续写、润色、总结选区、生成模板。
- 项目知识 Agent: 项目总结、故障复盘、交接文档、风险提取、周报。

## Context Pack

项目知识 Agent 必须先构建 Context Pack，再调用模型。Context Pack 至少包含:

- project profile
- timeline events
- related documents
- related blocks
- evidence list
- compressed summary

AI 回答必须基于证据来源，不得直接绕过权限读取数据库。

## Tool 规范

每个 Agent Tool 必须具备:

- Zod input schema。
- `ToolContext`，包含 `userId`、`tenantId`、`projectId?`、`documentId?`、`role`、`requestId`。
- 权限校验。
- 返回条数或 token 限制。
- 审计日志。
- 错误码和可观察日志。

## 写入原则

- AI 不直接写核心业务表。
- AI 生成 suggestion/draft，用户确认后由 Plate/Yjs 或 API 写入。
- 自动摘要、chunk、embedding 属于 worker 派生数据，可由任务写入。

## Worker 和 Mastra

- Mastra 只用于后台 workflow/agent 编排。
- 不用 Mastra 承担主业务 CRUD、权限事实源、审计事实源。
- Workflow 输入输出必须可序列化，失败可重试。

## 安全

- 不在 prompt 中注入密钥、连接串或用户不可见权限数据。
- 所有模型调用记录 request id、用户、项目、用途、token 预算。
- 私有化场景默认支持厂商模型 API 或中转接口，部署时必须显式配置。
