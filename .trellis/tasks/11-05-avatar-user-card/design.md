# 弹窗用户头像资料卡技术设计

## Boundaries

- 只修改 `LinuxDo 增强阅读.user.js` 与 README 版本/功能说明。
- 新增一个独立“用户资料卡”区块，包含样式、数据请求、渲染、定位和生命周期管理。
- `renderPost()` 与 `renderBoosts()` 只补充用户链接/头像上的 `data-*` 用户标识，不改变帖子/Boost 的现有结构。
- `bindActions()` 在链接放行逻辑之前拦截帖子用户链接和 Boost 头像点击；弹窗 `close()` 负责顺带关闭资料卡。

## Data Contract

- 请求：`GET {BASE}/u/{encodeURIComponent(username)}/card.json`，使用现有 `fetchJSON()`，携带当前登录态。
- 数据根：`response.user`；缺省时回退 `response`。
- 基础数据来自触发的用户链接/头像元素：
  - `data-username`：账号名，必填。
  - `data-name`：当前楼层/Boost 已知的显示名，可缺省。
  - `src`：当前头像地址。
- 卡片请求字段按需读取并做容错：
  - `avatar_template`：替换 `{size}` 为 `96`。
  - `trust_level`：展示为 `Lv.N`。
  - `created_at`、`last_seen_at`：使用现有 `fmtTime()`，加入时间显示为 `YYYY-MM`。
  - `time_read`：按秒转换为“X 分钟 / X 小时 / X 天”。
  - `featured_user_badges`、`user_badges`、`badges`：兼容对象数组、ID 数组与侧载数组。
  - `can_follow`、`is_followed`：控制关注按钮的显示与文案；缺省时视为不可关注。
- 缓存键为用户名，值为 Promise，避免并发重复请求；失败时从缓存删除，允许下次重试。

## Interaction And Lifecycle

- 全局只保留一个 `CURRENT_USER_CARD`。
- 触发范围：
  - 帖子头部的 `.ldp-user-link`：点击头像、昵称或 `@用户名` 均打开资料卡。
  - Boost 气泡的 `.ldp-boost-avatar-link` 或 `.ldp-b-avatar`：点击头像打开资料卡。
- 打开流程：
  1. 若点击的是当前卡片的触发头像，则关闭并返回。
  2. 关闭旧卡片。
  3. 基于基础数据创建卡片并追加到 `.ldp-overlay`。
  4. 定位、聚焦，并注册关闭监听。
  5. 异步请求资料，成功后原位补全并重新定位。
- 关闭来源：
  - 点击卡片外部（`mousedown` 捕获阶段）。
  - `Escape`（`keydown` 捕获阶段，阻止外层弹窗的 Esc 处理）。
  - 弹窗主体滚动（`scroll` 被动监听）。
  - 窗口 `resize`。
  - 外层弹窗 `close()`。
- 异步请求返回时若卡片已关闭/被替换，不写入 DOM。
- 卡片焦点使用 `tabindex="-1"`，打开后聚焦，便于键盘用户 Tab 到“查看资料”。
- 关注按钮遵循官方显示条件 `is_followed || can_follow`；点击后在请求期间禁用，按当前状态发送 `PUT` / `DELETE /follow/{username}.json`，成功后翻转缓存对象中的 `is_followed`，失败时保留原状态下不改动并显示行内错误。

## Positioning

- 卡片 `position: fixed`，`z-index: 2147483500`。
- 以触发元素（帖子用户链接或 Boost 头像）的 `getBoundingClientRect()` 为锚点，以 `.ldp-modal` 的矩形为边界。
- 水平左对齐头像；超出右边界时向左平移，最小保留 8px 内边距。
- 垂直优先放在头像下方 8px；下方不足且上方空间更大时翻转；两边都不足时限制最大高度并内部滚动。
- 卡片宽度限制为 `min(360px, 弹窗宽度 - 16px)`；资料补全后重新计算位置。

## Styling

- 采用 Discourse 官方用户卡的层级：头部头像 + 名称 + 头衔/等级，随后简介、元信息、统计、徽章和底部关注/查看资料按钮。
- 颜色全部使用站点变量：`--secondary`、`--primary`、`--primary-high`、`--primary-medium`、`--primary-low`、`--primary-very-low`、`--tertiary`，并提供浅色回退值。
- 圆角优先使用 `--d-border-radius-large`，阴影使用 `--shadow-dropdown` 回退值。
- 动画只做短促淡入和轻微位移，不依赖外部资源。

## Security And Compatibility

- 用户名、昵称、头衔、地点、网站、徽章名等文本字段统一 `esc()` / `escAttr()`。
- `bio_excerpt` 来自 Discourse 服务端净化结果；插入后把其中链接设置为 `target="_blank"` 和 `rel="noopener noreferrer"`。
- 个人网站仅允许 `http:` / `https:` 链接，其余不生成可点击链接。
- 头像 URL 与徽章图片 URL 只接受站点相对路径或 `http(s)` 地址。
- 所有新增监听器在关闭时移除；外层弹窗销毁后不残留全局事件。
- 不改动 `apiSend()`、已读追踪、话题加载、分片加载或投票逻辑。

## Rollback

- 运行时改动集中在单个 userscript；回滚时恢复该文件即可，README 与任务文档不影响运行。
