# API 手册

## 概述

当前阶段只建立 Hono API 框架和健康检查接口。业务 API 待后续模块开发时补充。

## 认证方式

待实现。目标设计为 API、Collab、AI Tool 共用权限上下文，至少包含 `userId`、`tenantId`、`projectId?`、`role`、`requestId`。

## 接口列表

### health

#### GET /health

**描述:** API 服务健康检查。

**响应:**

```json
{
  "ok": true,
  "service": "api",
  "version": "0.1.0"
}
```

#### GET /api/health

**描述:** API 前缀下的健康检查。

**响应:** 同 `/health`。

## 待规划 API

- `projects`
- `documents`
- `timeline_events`
- `search`
- `ai/editor-command`
- `ai/project-agent`
- `agent/tools`
