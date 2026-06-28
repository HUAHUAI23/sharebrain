# 技术设计: 修复 turbo dev 启动问题

## 技术方案

### 核心技术

- Node 24 运行 Hocuspocus 4。
- Bun 运行 API 和 Worker。
- Vite `strictPort` 固定 Web 端口。

### 实现要点

- `apps/collab/package.json` 的 `dev` 改为 `node src/index.ts`。
- `apps/api/package.json` 和 `apps/worker/package.json` 的 `dev` 改为 `bun src/index.ts`。
- `apps/worker/src/index.ts` 增加常驻 Promise。
- `apps/web/vite.config.ts` 增加 `strictPort: true`。

## 架构决策 ADR

### ADR-004: Hocuspocus 4 使用 Node 运行时

**上下文:** Hocuspocus 4 服务端包内部使用 crossws Node adapter，在 Bun runtime 下主动抛错。
**决策:** Collab 服务开发和部署运行时使用 Node 24+。
**理由:** 符合包声明 `engines.node >=22`，避免运行时 adapter 不兼容。
**替代方案:** 降级 Hocuspocus 或自行适配 Bun WebSocket → 拒绝原因: 当前阶段优先保持 latest 和低维护成本。
**影响:** Monorepo 同时存在 Bun 和 Node 运行时；文档需明确边界。

## 安全与性能

- **安全:** 无权限或密钥逻辑变更。
- **性能:** 无性能路径变更。

## 测试与部署

- `bun run typecheck`
- `bun run build`
- `timeout 5s bun run dev`
