# 开发规范

## 基础命令

```bash
bun install
bun run dev
bun run typecheck
bun run test
bun run build
bun run check
```

## 数据库开发命令

开发阶段数据库表结构会频繁变化，不生成 migration 文件，统一使用 Drizzle push 直推 schema。

```bash
bun run db:push
bun run db:reset
bun run db:reset:push
bun run db:studio
```

- `db:push`: 将 `packages/db/src/schema.ts` 当前结构推送到 PostgreSQL。
- `db:reset`: 删除并重建开发数据库，禁止在 `NODE_ENV=production` 执行。
- `db:reset:push`: 重建数据库后立即 push schema。
- `db:studio`: 打开 Drizzle Studio。

开发阶段禁止提交 `packages/db/drizzle/` migration 目录；进入稳定阶段后再引入 migration 流程。

## 本地端口

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- Collab: `ws://localhost:3002`

Vite 使用 `strictPort`，端口被占用时直接失败。不要依赖端口自动漂移。

## 依赖策略

- 新依赖默认使用 npm latest，并写入根 `workspaces.catalog`。
- workspace 内依赖使用 `workspace:*`。
- 只有存在明确兼容性问题时才锁定较旧版本，并在方案包或 ADR 记录原因。
- 不允许在单个 app/package 中散落第三方版本号，统一走 `catalog:`。

## 开发流程

1. 先更新或创建 `helloagents/plan/<timestamp>_<feature>/` 方案包。
2. 按任务清单分批实现，每个任务控制在 2-3 个文件。
3. 每次涉及接口、数据、架构、模块边界，都同步更新 `docs/` 和 `helloagents/wiki/`。
4. 完成后运行 `bun run typecheck`，必要时运行 `bun run build` 和相关测试。
5. 方案包执行完后迁移到 `helloagents/history/YYYY-MM/`。

## 环境变量

- 服务端配置由 `@sharebrain/config` 的 `loadServerEnv` 读取。
- 前端公开配置必须使用 `WEB_PUBLIC_` 前缀。
- 禁止提交真实密钥，`.env.example` 只放占位值。

## 运行时约定

- API 和 Worker 当前使用 Bun 运行时。
- Hocuspocus 4 协作服务使用 Node 运行时，原因是其服务端实现使用 Node adapter，并声明 `engines.node >=22`。
- `bun --hot` 会额外启动 Bun 开发服务器并占用默认端口；当前服务端 dev 脚本不使用 `--hot`。
- Bun API 入口不要 `export default { fetch }` 或 `export default app`，本项目统一使用显式 `Bun.serve({ port })` 避免默认端口冲突。

## 分支和提交

- 提交信息使用 `type(scope): summary`，如 `feat(web): add editor shell`。
- 文档和规范更新可以使用 `docs(scope): summary`。
- 不混入无关格式化和参考仓库文件。
