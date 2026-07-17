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

## 容器镜像

GitHub Actions 为四个运行服务构建 `linux/amd64` 与 `linux/arm64` 镜像：

- `ghcr.io/huahuai23/sharebrain-web`，监听 8080。
- `ghcr.io/huahuai23/sharebrain-api`，默认监听 3001。
- `ghcr.io/huahuai23/sharebrain-collab`，默认监听 3002。
- `ghcr.io/huahuai23/sharebrain-worker`，不暴露端口。

Pull Request 只验证镜像构建；提交到 `main`、推送 `v*.*.*` 标签或手动运行 workflow 时发布到 GHCR。Web 镜像在构建时读取可选 GitHub repository variables `WEB_PUBLIC_API_BASE_URL` 和 `WEB_PUBLIC_COLLAB_WS_URL`，它们必须是公开地址，密钥不得作为 Web build argument。

镜像使用 branch/tag、SemVer、完整 commit SHA 与默认分支 `latest` 标签，并附带 OCI metadata、SBOM、BuildKit provenance 和 GitHub artifact attestation。Docker Hub 不在发布范围内。

## 规范文档

- `docs/architecture.md`
- `docs/project-structure.md`
- `docs/standards/development.md`
- `docs/standards/code-style.md`
- `docs/standards/ui-design.md`
- `docs/standards/ai-development.md`
- `helloagents/`: AI 开发知识库与变更历史。
