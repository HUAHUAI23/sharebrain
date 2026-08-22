# ShareBrain

ShareBrain 是面向私有化交付、运维和项目团队的项目周期上下文管理平台，包含项目工作台、协作文档、版本/活动历史、混合知识检索、多轮 AI 问答和知识治理。

## 快速开始

```bash
bun install
bun run db:ext
bun run db:push
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
- `packages/knowledge`: 中文分词、Plate 分块、概念规范化和检索排序算法。
- `packages/typescript-config`: TypeScript 基础配置。

## 容器镜像

GitHub Actions 为四个运行服务构建 `linux/amd64` 与 `linux/arm64` 镜像：

- `ghcr.io/huahuai23/sharebrain-web`，监听 8080。
- `ghcr.io/huahuai23/sharebrain-api`，默认监听 3001。
- `ghcr.io/huahuai23/sharebrain-collab`，默认监听 3002。
- `ghcr.io/huahuai23/sharebrain-worker`，不暴露端口。

Pull Request 只验证镜像构建；提交到 `main`、推送 `v*.*.*` 标签或手动运行 workflow 时发布到 GHCR。Web 镜像与部署环境无关，启动时从 Pod 环境变量生成 `/runtime-config.json`；全部 `WEB_PUBLIC_*` 都会暴露给浏览器，只允许公开地址和功能参数，禁止填写密钥。不配置时 API 使用同源 `/api`，Collab 使用当前域名的 `/collab` WebSocket。

部署数据库必须是支持 pgvector 的 PostgreSQL，并在 schema push 前执行 `bun run db:ext`。发布检查需确认 `vector` 扩展、两个 generated FTS 列、知识 job/concept 条件唯一索引和 `idx_knowledge_embeddings_hnsw` 均存在。未配置 embedding 时系统降级到 FTS；问答模型未配置时聊天 API 返回 `AI_NOT_CONFIGURED`。

镜像使用 branch/tag、SemVer、完整 commit SHA 与默认分支 `latest` 标签，并附带 OCI metadata、SBOM、BuildKit provenance 和 GitHub artifact attestation。Docker Hub 不在发布范围内。

## 规范文档

- `docs/architecture.md`
- `docs/project-structure.md`
- `docs/standards/development.md`
- `docs/standards/code-style.md`
- `docs/standards/ui-design.md`
- `docs/standards/ai-development.md`
- `helloagents/`: AI 开发知识库与变更历史。
