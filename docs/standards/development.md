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
bun run db:seed
```

- `db:push`: 将 `packages/db/src/schema.ts` 当前结构推送到 PostgreSQL。
- `db:reset`: 删除并重建开发数据库，禁止在 `NODE_ENV=production` 执行。
- `db:reset:push`: 重建数据库后立即 push schema。
- `db:studio`: 打开 Drizzle Studio。
- `db:seed`: 幂等写入开发期默认用户、个人空间、预设模块模板和示例项目。

开发阶段禁止提交 `packages/db/drizzle/` migration 目录；进入稳定阶段后再引入 migration 流程。

当前开发数据库使用项目指定的 PostgreSQL 开发实例；连接串只通过本地环境变量传入命令，不写入仓库。初始化新开发库时先执行 `bun run db:reset:push`，再执行 `bun run db:seed`。

## 本地端口

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- Collab: `ws://localhost:3002`

Vite 使用 `strictPort`，端口被占用时直接失败。不要依赖端口自动漂移。
Web 默认使用同源 `/api` 请求后端，开发期由 Vite proxy 转发到 `http://localhost:3001`；只有跨域部署或调试时才设置 `WEB_PUBLIC_API_BASE_URL` 覆盖。

## 依赖策略

- 新依赖默认使用 npm latest，并写入根 `workspaces.catalog`。
- workspace 内依赖使用 `workspace:*`。
- workspace 内第三方依赖版本统一写 `catalog:`；shadcn CLI 自动写入 package 版本后必须改回 catalog，并运行 `bun install` 刷新锁文件。
- 只有存在明确兼容性问题时才锁定较旧版本，并在方案包或 ADR 记录原因。
- 如果用户明确要求接入预发布主版本，可使用 npm dist-tag 或精确预发布版本，并在方案包和知识库记录该版本不是 stable `latest`。
- 不允许在单个 app/package 中散落第三方版本号，统一走 `catalog:`。

## shadcn/Tailwind 开发

- Tailwind 使用 v4 CSS-first 方式，Web 通过 `@tailwindcss/vite` 插件处理，不维护 `tailwind.config.js`。
- 全局 Tailwind 入口是 `packages/ui/src/styles/globals.css`，通过 `@import "tailwindcss"`、`:root` 语义变量和 `@theme inline` 暴露 token；禁止重新引入 v3 的 `@tailwind base/components/utilities` 入口。
- `globals.css` 必须显式声明 monorepo 扫描范围: `@source "../components"`、`@source "../hooks"`、`@source "../../../../apps/web/src"`。路径按 CSS 文件位置计算，调整目录时必须重新验证。
- shadcn monorepo 配置固定为双 `components.json`: `packages/ui/components.json` 负责组件生成，`apps/web/components.json` 负责 app 侧别名解析。
- 新增 shadcn 基础组件时使用 `npx shadcn@latest add <component> -c packages/ui`；批量安装基础组件可用 `npx shadcn@latest add --all -c packages/ui -y --overwrite`。
- `add --all` 只用于建立基础组件覆盖面；后续如果组件引入未使用运行时依赖，应在审计后移除，避免 catalog 和包依赖膨胀。
- shadcn 生成代码必须通过 `bun --filter @sharebrain/ui typecheck`；遇到 `exactOptionalPropertyTypes` 时，不要向 Radix/Base UI 组件透传值为 `undefined` 的可选 prop。
- shadcn 基础组件的视觉必须在 `packages/ui` 内收敛到项目 token，不在 `apps/web/src/styles/app.css` 中覆盖基础组件默认样式。
- `apps/web/src/styles/app.css` 不承载跨页面 UI primitive；块级列表、图标块、空态、顶部栏、分段控制应沉淀到 `packages/ui/src/components/notion.tsx`。
- Tailwind utility 优先使用内置语义类，不用等价 arbitrary value: `space-y-px` 优于 `space-y-[1px]`，`mt-px` 优于 `mt-[1px]`，`rounded-sm` 优于 `rounded-[4px]`，`top-px` 优于 `top-[1px]`。
- Tailwind v4 线性渐变使用 `bg-linear-to-*` 或 `bg-linear-<angle>`，不再新增 `bg-gradient-to-*`。
- Tailwind v4 CSS 变量值优先使用括号简写: `ring-(--ring-soft)`、`border-(--color-border)`、`bg-(--color-bg)`，不要写成 `ring-[var(--ring-soft)]` 或 `border-[color:var(--color-border)]`。
- arbitrary values 只允许用于三类场景: Radix/Base UI/shadcn 暴露的 CSS 变量尺寸和 transform origin、Plate 或复杂响应式布局确实没有等价 utility、Notion 视觉规格需要固定但尚未抽成 token。相同 arbitrary value 重复出现两次以上时，优先抽到 `@theme` token、UI primitive 或 app CSS 局部类。
- 禁止用 viewport 宽高直接缩放正文或按钮字号，例如 `text-[3vw]`；禁止负 `letter-spacing` 作为默认排版手段。确需特殊展示效果时必须写在局部 CSS 并说明原因。

## 国际化开发

- Web 静态文案必须通过 `@sharebrain/i18n` 的 Paraglide 消息函数输出。
- 新增文案先同步写入 `messages/zh-CN.json` 和 `messages/en-US.json`，再在组件中调用 `m.<key>()`。
- `packages/i18n/src/paraglide/` 由 `@inlang/paraglide-js` CLI 生成，禁止手工编辑。
- `apps/web/vite.config.ts` 使用 `paraglideVitePlugin`，开发和构建会自动重新生成 `apps/web/src/paraglide/`；Web 业务代码仍只从 `@sharebrain/i18n` 导入消息。
- `packages/i18n` 的 build/typecheck 通过 `scripts/with-paraglide.ts` 串行化 Paraglide 编译，避免 Turbo 并行任务同时删除生成目录。
- 当前支持 `zh-CN` 和 `en-US`；语言选择使用 Paraglide `localStorage -> preferredLanguage -> baseLocale` 策略，暂不写入用户表。

## 开发流程

1. 先更新或创建 `helloagents/plan/<timestamp>_<feature>/` 方案包。
2. 按任务清单分批实现，每个任务控制在 2-3 个文件。
3. 每次涉及接口、数据、架构、模块边界，都同步更新 `docs/` 和 `helloagents/wiki/`。
4. 完成后运行 `bun run typecheck`，必要时运行 `bun run build` 和相关测试。
   - 涉及 Web、构建配置或跨 workspace 合约时，必须同时运行 `bun run test`、`bun run build` 和 `bun run lint:docs`。
   - 账户、模块配置和动态表单等关键交互变更必须使用 Playwright 覆盖桌面与移动视口，并检查控制台错误和横向溢出。
5. 没有测试文件的 workspace 必须让 `test` 脚本显式成功并输出占位信息，避免 `bun run check` 因 “No tests found” 失败。
6. 方案包执行完后迁移到 `helloagents/history/YYYY-MM/`。

## 环境变量

- 服务端配置由 `@sharebrain/config` 的 `loadServerEnv` 读取。
- 前端公开配置必须使用 `WEB_PUBLIC_` 前缀，Vite 配置必须允许该前缀。
- 禁止提交真实密钥，`.env.example` 只放占位值。
- 开发期 auth 使用 `DEV_AUTH_USER_ID`、`DEV_AUTH_TENANT_ID`、`DEV_AUTH_ROLE`，业务 route 不得写死用户。
- 密码认证使用 `AUTH_PASSWORD_REGISTRATION_ENABLED` 控制是否允许注册，使用 `AUTH_SESSION_COOKIE_NAME` 和 `AUTH_SESSION_EXPIRES_DAYS` 管理 session cookie。
- `AUTH_DEV_BYPASS_ENABLED` 只用于开发/测试后门，关闭后必须通过登录 session 访问 `/api/*`。
- AI 生成使用 `AI_MODEL_PROVIDER`、`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_MAX_OUTPUT_TOKENS`；未配置时 `/api/ai/command` 返回 `AI_NOT_CONFIGURED`，不允许把密钥写入仓库。
- S3/MinIO 配置统一使用 `S3_*` 和 `MEDIA_*` 环境变量；开发默认值只用于本地 MinIO 占位，真实环境必须覆盖，媒体读取 URL 必须由 API 按权限短时签发。
- 当前媒体模型不保存 S3 VersionId，媒体 bucket 必须关闭 versioning；Worker 部署身份必须具备 `s3:GetBucketVersioning` 和 `s3:DeleteObject`，无法确认 bucket 未版本化时不得把媒体标记为 purged。
- 头像上传限制由 `MEDIA_AVATAR_MAX_BYTES` 控制；上传文件只接受 JPEG/PNG/WebP，完成阶段由 API 规范化为 512x512 WebP。
- 媒体物理清理由 `MEDIA_GC_INTERVAL_SECONDS`、`MEDIA_GC_BATCH_SIZE` 和 `MEDIA_GC_PROCESSING_TIMEOUT_SECONDS` 控制。Worker 必须串行调度每轮 GC，禁止重叠执行；删除失败使用持久化任务重试，不在请求链路直接依赖 S3 删除成功。

## 运行时约定

- API 和 Worker 当前使用 Bun 运行时。
- Hocuspocus 4 协作服务使用 Node 运行时，原因是其服务端实现使用 Node adapter，并声明 `engines.node >=22`；dev 脚本使用 `tsx watch`（Node 原生 type-stripping 不支持 monorepo 无扩展名 TS 导入）。
- `bun --hot` 会额外启动 Bun 开发服务器并占用默认端口；当前服务端 dev 脚本不使用 `--hot`。
- Bun API 入口不要 `export default { fetch }` 或 `export default app`，本项目统一使用显式 `Bun.serve({ port })` 避免默认端口冲突。

## 分支和提交

- 提交信息使用 `type(scope): summary`，如 `feat(web): add editor shell`。
- 文档和规范更新可以使用 `docs(scope): summary`。
- 不混入无关格式化和参考仓库文件。
