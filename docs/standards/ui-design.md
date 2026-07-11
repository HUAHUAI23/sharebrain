# UI 设计规范

## 设计方向

UI 参考 Notion 的主设计气质：中性、克制、内容优先、低装饰、清晰层级。ShareBrain 是长期高频使用的项目知识工作台，不做营销页式视觉。

## 色彩

- 背景: `#ffffff`
- 侧边栏: `#fbfbfa`
- 表面: `#ffffff`
- 次级背景: `#f7f6f3`
- Hover: `#f1f1ef`
- 文本: `#37352f`
- 次级文本: `#787774`
- 边框: `#e9e9e7`
- 主色: `#2f76d2`

规则:
- 不使用大面积渐变、发光球、装饰图形。
- 页面主色只能作为交互和状态强调，不做大面积铺底。
- 卡片圆角不超过 6px，优先弱边框或无边框。

## 图标

- 图标使用 lucide-react，默认 14-16px。
- 图标保持单色细线风格，默认 `stroke-width: 1.75`。
- 导航、页面、工具栏图标不使用彩色填充图标。
- 项目或文档可使用少量中性底色字母/页面图标，但不使用高饱和插画。
- 图标按钮必须用 `aria-label` 描述功能。

## 布局

- 第一屏必须是可用工作台，而不是 landing page。
- 未登录第一屏只展示必要的登录/注册表单，不做营销页或产品介绍页。
- 操作面板、文档区、搜索区保持高信息密度。
- 页面 section 不嵌套卡片；卡片只用于重复条目、工具面板、modal。
- 固定格式元素要有稳定尺寸，避免 hover 或动态文本导致布局跳动。
- 侧边栏使用块级列表，不做强分割线；hover 用浅灰块。
- 页面标题区保留页面图标和轻量工具栏，不使用大面积 header 卡片。
- 已认证工作台统一在右上角放置圆形头像触发器；账户菜单宽度保持紧凑，只展示身份、空间容量摘要和设置命令，不在 DropdownMenu 内嵌复杂表单。
- 设置页面使用稳定内容列。对象列表与详情同时存在时采用主从布局，选中对象写入 URL；移动端允许顺序堆叠，但不能产生横向溢出。
- 文档编辑页顶部栏应轻量、固定定位、无底部分割线，不参与正文文档流；当前默认只展示左侧导航/标题和右侧协作/更多动作。标题和正文必须共享同一内容列左边线，块手柄所需 gutter 由页面级编辑器布局统一控制。文档标题保持单行输入，按 Enter 后正文第一行出现输入光标；如果正文首行已有内容，则先在正文最前面插入空段落并整体下移原内容。正文首个空段落后面仍有内容时，Backspace/Delete 应能删除该空段落。

## 组件

- 基础组件来自 `packages/ui`，按 shadcn 组件形态维护。
- `packages/ui` 是 shadcn 基础组件唯一维护位置；业务组件只在 `apps/web/src/components` 或 feature 内维护。
- Tailwind token 来自 `packages/ui/src/styles/globals.css` 的语义变量和 `@theme inline` 映射；业务页面样式可写在 `apps/web/src/styles/app.css`，但不得在其中重新定义基础组件库。
- Tailwind className 必须优先使用项目 token 和标准 utility；只有 Radix/shadcn CSS 变量、复杂布局约束或明确 Notion 视觉规格才允许使用 arbitrary value。
- 业务组件不要直接散落 `rounded-[4px]`、`mt-[1px]`、`space-y-[1px]`、`text-[3vw]` 等写法；应使用 `rounded-sm`、`mt-px`、`space-y-px`、固定字号 token 或局部 CSS。
- CSS 变量型样式使用 Tailwind v4 shorthand，例如 `border-(--token)`、`ring-(--ring-soft)`、`bg-(--token)`。
- Button、Input、Card、Dialog 等基础组件默认应紧凑、低阴影、弱边框、弱 focus ring，避免 shadcn 默认强卡片和强阴影直接暴露到业务页。
- TooltipProvider 和 Toaster 由 `packages/ui` 的 `UIProvider` 统一提供；业务 feature 不重复挂基础 UI provider。
- 图标按钮使用 lucide-react。
- 块级列表行、页面图标、空态、顶部栏、分段控制等跨页面 Notion 形态使用 `@sharebrain/ui/components/notion` primitives，不在 app 全局 CSS 中重复定义。
- Notion 风格新建入口使用块级 `+` 行：整行浅灰 hover、无强按钮边框、图标为单色 `Plus`；不能只因标题为空禁用提交，空标题应创建“未命名...”对象或在行内显示错误。
- 跨页面复用的新建行使用 `@sharebrain/ui/components/notion-create-row`；场景化输入样式优先使用 `inputClassName`，app CSS 只允许对具体业务布局做少量稳定 slot 覆盖。
- 头像更换使用独立 Dialog：先展示当前头像及对象字节数、空间可用容量，选择 JPEG/PNG/WebP 后提供 1:1 裁剪和缩放，再显式确认上传；上传限制由服务端接口下发，移除后立即回退稳定生成头像。上传或移除 pending 时禁止关闭 Dialog。
- 空间容量在账户菜单展示占用与预留/总量摘要，在独立页面展示可用、上传预留、正在释放和按用途分类；生成头像不占用对象存储配额。
- 初始模块设置使用块级列表 + 详情主从布局。创建模块使用 Dialog，身份字段与“包含在新项目中”开关使用同一次显式保存；字段创建/编辑使用独立 Sheet；字段删除、模块删除、恢复系统配置等破坏性动作必须二次确认。
- 动态字段复杂表单使用独立 Sheet 或 Dialog，不塞入紧凑新建行。打开记录创建器时必须直接显示继承后的默认值，并允许用户覆盖；保存具体值，不展示内部默认表达式；创建请求 pending 时禁止关闭表单。
- 二元设置用 switch/checkbox。
- 模式切换用 segmented/tabs。
- 数值配置用 slider/stepper/input。
- 菜单选项用 menu/select。
- 项目模块只按 `timeline` 和 `collection` 两种原型渲染，不按“日志/背景/知识库/自定义”写死四套页面；侧边导航可以根据 API 派生的固定系统模块身份做一级/二级分组。
- 动态字段表单标签来自字段定义，提交值必须按不可变 fieldId 组织，并按字段类型使用对应输入控件；不要把 select/boolean/datetime 等字段降级成普通文本输入。

## 文案

- 不在界面写“这是功能介绍/如何使用”式说明。
- 按工作流写具体对象和状态，如“项目上下文”“文档树”“时间线”。
- 按钮文案短且动作明确。

## 可访问性

- 图标按钮必须有 `aria-label`。
- 文本与背景对比度满足长期阅读。
- 输入控件必须有 label 或等价 aria 名称。
