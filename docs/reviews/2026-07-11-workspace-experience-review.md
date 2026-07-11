# 工作台体验改动代码审查

> 审查基线：`f44134f86081f24755202656190aaa80d02e4f8f`（`main` / `origin/main`）
> 审查范围：当前工作树全部待提交差异
> 审查日期：2026-07-11

## 1. 功能清单

本次待提交代码实现了以下产品能力：

1. 在所有已认证工作台页面右上角提供统一账户菜单，收敛用户身份、空间、语言、容量、新项目配置和退出登录入口。
2. 使用 DiceBear `notionists-neutral` 为未上传头像的用户生成稳定头像，新增头像选择、裁剪、缩放、上传、替换和移除流程。
3. 新增 tenant 存储配额、媒体上传预留、用途统计、持久化删除任务及 Worker S3/MinIO 物理删除与重试。
4. 将“默认模块”重构为“新项目配置 / 初始模块”，新增深链接、启停、排序、系统恢复和字段 Sheet。
5. 将动态字段默认值升级为 `none | literal | now | today | current_user`，新增 user 字段和复杂记录创建 Sheet。
6. 同步扩展 Hono API、Drizzle schema、contracts、i18n、Turbo 配置、测试和项目文档。

## 2. 审查依据

- 项目规范：`helloagents/project.md`、`helloagents/wiki/*`、`docs/architecture.md`、`docs/project-structure.md`、`docs/standards/*`。
- Drizzle ORM 官方事务文档：<https://orm.drizzle.team/docs/transactions>。
- AWS SDK v3 Presigned POST 实现与文档：<https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-presigned-post>。
- AWS S3 `DeleteObject` 版本化语义：<https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html>。
- TanStack Form React 与重置语义：<https://tanstack.com/form/latest/docs/framework/react/overview>。
- Sharp 构造参数和输入像素限制：<https://sharp.pixelplumbing.com/api-constructor>。

## 3. 确认问题

### P0：媒体引用恢复与物理删除存在竞态

`syncDocumentInlineMediaUsagesWithClient` 可以把 `pending_delete` 恢复为 `active`，Worker 则在另一个事务外检查 usage 后将对象切换为 `deleting` 并调用 S3。两条路径没有共同的串行化边界，可能出现 Worker 已决定删除后又建立 active usage，最终数据库仍有引用但对象已被物理删除。

**修复：** 所有 usage 建立/恢复与 Worker 删除决策都先锁定同一 `media_objects` 行；usage 只允许关联 `active/pending_delete`，Worker 在一个事务中锁行、重查 usage 并切换为 `deleting`。`deleting/purged` 不再允许恢复引用。

### P0：上传完成接口未绑定会话创建者

完成接口只按 `uploadId + tenantId + pending` 查询。知道同 tenant 其他成员的 uploadId 后，可以完成对方上传；头像用途下还可能把对方上传绑定到自己的头像。

**修复：** 上传读取、完成和幂等返回都必须同时匹配 `media_uploads.created_by` 与 `media_objects.created_by`。

### P1：配额失败前已签发可用上传策略

Presigned POST 在 tenant 锁和配额检查之前生成。配额事务失败时，策略仍可向对象存储写入对象，但数据库没有 media/upload 记录，现有 GC 无法发现和回收该对象。

**修复：** 在 tenant 行锁和配额确认后生成策略，并在同一事务中写入 reservation；任一环节失败都不向调用者暴露策略。

### P1：通用忽略规则误排除容量功能源码

`.gitignore` 使用未锚定的 `storage/` 规则，本意是忽略仓库根目录运行时数据，却同时忽略了 `apps/web/src/features/storage/`。当前工作树可借助本地文件通过构建，但提交后的干净检出会缺少 `StorageView` 和 `formatBytes`，导致 Web 无法构建。

**修复：** 将本地运行数据规则锚定为 `/storage/` 与 `/uploads/`，只忽略仓库根目录数据；容量功能源码进入正常 Git 跟踪范围，并纳入最终构建与工作树完整性检查。

### P1：头像规范化可能突破预留配额

当前 reservation 使用客户端声明的源文件大小，512x512 WebP 输出可能大于较小源文件；完成阶段直接把更大的实际字节数写回数据库。替换头像还提前抵扣旧头像，但旧对象在物理删除前仍占空间。

**修复：** 头像 reservation 取“源文件大小”和“服务端规范化输出上限”的较大值，规范化结果超过上限直接拒绝；不提前抵扣仍存在的旧头像。完成事务只把 reservation 收敛为实际值。

### P1：头像解码缺少输入像素上限

仅限制压缩文件字节数不能防止高像素压缩图片消耗大量内存。

**修复：** Sharp 显式配置 `limitInputPixels` 和严格解码错误策略，并测试超大尺寸或非法输入。

### P1：S3 版本化会破坏“已释放空间”语义

不带 `VersionId` 的 `DeleteObject` 在版本化 bucket 中通常只写入 delete marker，旧版本仍占物理空间；当前代码却把 media 标记为 `purged`。

**修复：** Worker 删除前检查 bucket versioning，明确拒绝 `Enabled/Suspended` bucket，并在运行规范中声明 `s3:GetBucketVersioning` 权限和非版本化 bucket 前提。

### P1：成员校验与成员候选列表不一致

user 字段校验只检查 active membership，不检查 `users.status/deleted_at`；`/api/members` 又直接查询 users，没有以 membership 为成员事实源。禁用、软删除或已移除 membership 的用户可能被错误接受或展示。

**修复：** 两条路径统一 join `tenant_memberships + users`，同时要求 membership 未删除、user active 且未删除。

### P1：记录 PATCH 会重新应用创建默认值

`PATCH /api/module-records/:id` 将 `values` 传给完整创建校验。缺失字段会重新计算 `now/today/current_user`，与 PATCH 的局部更新语义冲突。

**修复：** 创建和更新使用不同校验入口；创建补默认值并校验 required，PATCH 只校验传入字段并 merge 到现有 values，不重新继承默认值。

### P2：默认头像和登录头像描述存在双事实源

序列化器使用 `generated-v1`，渲染器使用 `notionists-neutral-v1`；登录响应也不读取已上传头像。缓存版本升级和登录后首屏可能展示错误头像。

**修复：** 抽取单一头像 descriptor 服务，`/api/me`、`/api/members` 和 auth response 共用同一版本与已上传头像查询。

### P2：上传完成不幂等

成功完成后客户端因网络错误重试会得到 404，无法区分“从未完成”和“已完成但响应丢失”。

**修复：** 同一创建者对 completed upload 的重试返回当前 media descriptor，不重复切换引用。

### P2：媒体状态包含不可达的 `failed`

删除失败由 deletion job 的 `failed` 表达，media 本身回到 `pending_delete`；`media.status=failed` 没有写入路径。

**修复：** 从 contract 和文档移除不可达状态，保持状态机最小且可证明。

### P2：Worker 任务选择缺少稳定顺序

批量查询只 `limit` 不排序，持续新增任务时无法保证较早到期任务优先。

**修复：** 按 `next_attempt_at`、`created_at` 排序后领取，并保留原子 claim。

### P2：布尔字段显示状态与提交状态不一致

`undefined/null` 被 Switch 显示为“否”，但表单没有写入 `false`。required boolean 会被前端判空；新建 literal boolean 默认值也可能以 `null` 提交并被服务端拒绝。

**修复：** 为记录表单和字段默认值编辑器建立类型化初始值，布尔控件展示“否”时实际值就是 `false`。

### P2：表单错误和 pending 关闭状态未收敛

头像上传、模块创建、字段保存、记录创建的旧 mutation error 可能在下一轮编辑继续显示；头像 Dialog 和字段 Sheet 在 pending 时仍可通过 ESC 或外部点击关闭。

**修复：** 打开/编辑/输入时 reset mutation；头像、字段与记录创建异步操作 pending 时阻止关闭并禁用取消动作。

### P2：模块分组顺序与持久化顺序不一致

界面把固定模块和自定义模块分组显示，重排却基于未分组的全局 `items`。当数据库顺序交错时，用户看到的移动结果和提交顺序不同。

**修复：** 以“固定模块 + 自定义模块”的展示顺序作为唯一规范顺序，拖拽和上下移动都在该序列计算。

### P2：模块启用开关与身份表单使用两种保存模型

名称等字段显式保存，`includedInNewProjects` 却立即 mutation；查询刷新可能 reset 并覆盖同表单内尚未保存的修改。

**修复：** 开关纳入 TanStack Form，与身份字段一次显式保存。

### P2：服务与组件边界过宽

`ModulesService` 同时管理初始模板、项目模块、字段、记录和索引，已达到 19 个公开方法、1173 行；`module-template-editor.tsx` 同时承担列表详情、身份表单和复杂字段 Sheet。它们有不同权限、事务和状态生命周期，继续扩展会增加回归面。

**修复：** 后端拆为 `ModuleTemplatesService`、`ProjectModulesService`、`ModuleRecordsService` 和共享 access/member validation；前端拆出 identity form、field editor sheet 与共享 payload types。路由直接依赖对应 service，不保留兼容 facade。

### P3：内部页面意图仍使用旧产品命名

`WorkspaceView` 仍保留 `module-templates`，与页面和路由“新项目配置”不一致。

**修复：** 开发阶段直接改为 `new-project-settings`，不保留旧别名。

## 4. 明确不改的项

- `appendSortKey` 使用时间戳和随机熵避免并发 count 排序冲突，重排时再归一化为固定宽度序号；在当前规模下是合理取舍。
- 模板与字段重排使用事务内逐行 update。初始模块数量很小，批量 CASE SQL 会降低可读性，当前实现不是性能问题。
- 页面级 Tailwind arbitrary grid track 用于稳定主从布局和响应式控制，符合项目规范中“复杂响应式布局”例外，不需要机械抽成 CSS。
- HTML5 drag-and-drop 不是移动端唯一入口，已有上下移动命令作为可访问和触屏兜底；保留该组合，但必须通过移动端验收确认无横向溢出。
- media purpose 保留 `attachment/cover` 作为已进入数据模型的用途分类，虽然上传入口尚未开放，不视为死代码。

## 5. 验收要求

1. 媒体并发测试证明 deleting 后不能恢复 usage，active usage 存在时 Worker 不调用对象删除。
2. API 测试覆盖跨成员完成上传拒绝、完成幂等、策略不在配额失败时生成、禁用成员拒绝、PATCH 不重算默认值。
3. 头像测试覆盖输入像素限制、输出上限、替换/移除引用和容量统计。
4. 运行 `bun run test`、`bun run typecheck`、`bun run build`、`bun run lint:docs`。
5. 使用 Playwright 在桌面和移动视口验证账户菜单、头像 Dialog、新项目配置、字段 Sheet和记录创建，并检查控制台错误与横向溢出。
