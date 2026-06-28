# collab

## 目的

提供 Hocuspocus/Yjs 协作服务。

## 模块概述

- **职责:** WebSocket 协作连接、鉴权、只读/可编辑权限 gate、Yjs snapshot 存储事件、索引任务触发。
- **状态:** 🚧开发中
- **最后更新:** 2026-06-26

## 规范

### 需求: 协作服务框架搭建

**模块:** collab

建立 `apps/collab`，使用 Hocuspocus 独立运行，不与 Hono 主业务 API 混合。

#### 场景: 协作连接

- 连接必须携带 token。
- 当前阶段只保留鉴权钩子和 `onStoreDocument` 事件。
- 后续接入权限、Yjs snapshot 持久化和索引任务队列。
- Hocuspocus 4 服务端使用 Node adapter，开发脚本必须使用 Node 运行，不能用 Bun runtime。

## 依赖

- `@hocuspocus/server`
- `yjs`
- `@sharebrain/config`

## 变更历史

- [202606261041_framework](../history/2026-06/202606261041_framework/) - 初始化协作服务骨架。
