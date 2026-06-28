# api

## 目的

提供 Hono 主业务 API 服务。

## 模块概述

- **职责:** HTTP API、权限上下文、业务服务入口、AI tool 入口。
- **状态:** 🚧开发中
- **最后更新:** 2026-06-26

## 规范

### 需求: API 框架搭建

**模块:** api

建立 `apps/api`，当前只提供 health 和统一 404，后续业务按 route/service/repository 分层实现。

#### 场景: 健康检查

- `GET /health` 返回 API 服务状态。
- `GET /api/health` 返回 API 服务状态。
- 开发脚本使用 `bun src/index.ts`，避免 `bun --hot` 额外占用 3000 端口。
- API 入口不能 `export default app`，否则 Bun 会自动启动默认端口服务并与 Vite 冲突。

## 依赖

- `@sharebrain/config`
- `@sharebrain/contracts`
- `@sharebrain/db`
- Hono
- Zod

## 变更历史

- [202606261041_framework](../history/2026-06/202606261041_framework/) - 初始化 API 骨架。
