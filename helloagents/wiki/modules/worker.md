# worker

## 目的

提供后台任务、文档索引和 AI workflow 入口。

## 模块概述

- **职责:** 文档索引、plain text/block/chunk 派生、摘要、embedding、项目周报、风险扫描。
- **状态:** 🚧开发中
- **最后更新:** 2026-06-26

## 规范

### 需求: Worker 框架搭建

**模块:** worker

建立 `apps/worker`，轻量引入 Mastra 和 AI SDK，但不承担主业务 CRUD。

#### 场景: 文档索引任务

- Collab 或 API 触发索引任务。
- Worker 读取文档派生数据并更新搜索/AI 上下文表。
- 当前阶段只保留任务类型和队列占位函数。
- 开发模式下 Worker 保持进程运行，便于 `turbo dev` 统一管理。

## 依赖

- `@mastra/core`
- `ai`
- `@sharebrain/db`
- `@sharebrain/contracts`

## 变更历史

- [202606261041_framework](../history/2026-06/202606261041_framework/) - 初始化 Worker 骨架。
