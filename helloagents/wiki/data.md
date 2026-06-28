# 数据模型

## 概述

数据选择 PostgreSQL。当前阶段在 `packages/db/src/schema.ts` 中定义核心表骨架，开发期使用 Drizzle push 直推 schema，不生成 migration 文件。

## 数据表

### projects

**描述:** 项目空间主表。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | uuid | 主键 | 项目 ID |
| tenant_id | uuid | 非空 | 租户 ID |
| name | text | 非空 | 项目名 |
| customer_name | text | 可空 | 客户名 |
| status | text | 非空 | 状态 |
| tags | text[] | 非空 | 标签 |

### documents

**描述:** 文档元数据。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| id | uuid | 主键 | 文档 ID |
| project_id | uuid | 外键 | 所属项目 |
| title | text | 非空 | 标题 |
| doc_type | text | 非空 | 文档类型 |
| current_version | int | 非空 | 当前版本 |

### document_crdt_snapshots

**描述:** Hocuspocus/Yjs 协作恢复快照。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| document_id | uuid | 主键/外键 | 文档 ID |
| ydoc_snapshot | text | 非空 | 当前骨架用文本占位，后续应迁移为 bytea |
| state_vector | text | 可空 | Yjs state vector |

### document_versions

**描述:** Plate JSON、plain text、HTML 和版本摘要。

### document_blocks

**描述:** 文档 block，用于搜索命中和跳转定位。

### search_items

**描述:** 全库搜索统一索引。

### timeline_events

**描述:** 项目生命周期事件。

### document_chunks

**描述:** AI 上下文 chunk。

### audit_logs

**描述:** 权限、AI、搜索、导出等审计日志。

## 后续注意

- CRDT snapshot 正式实现应使用 PostgreSQL `bytea`。
- 中文搜索增强可按阶段评估 PostgreSQL FTS、PGroonga、pg_jieba、pgvector。
- 不建议 MVP 直接引入 Elasticsearch。
- 开发阶段只使用 `bun run db:push`、`bun run db:reset`、`bun run db:reset:push`、`bun run db:studio`。
