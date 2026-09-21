# 弹框支持 L 站投票技术设计

## Boundaries

- 只修改 `LinuxDo 增强阅读.user.js`，并按现有单文件用户脚本结构内聚新增函数与样式。
- `renderPost()` 负责把 `post.cooked` 里的原生投票占位替换为脚本渲染的 `.ldp-poll`。
- `bindActions()` 继续承担弹框级事件委托，新增投票点击、提交和撤销分支。
- `apiSend()` 保持现有 Cookie、CSRF、JSON 和表单编码行为，只补两处通用能力：
  - 数组参数按 Discourse 表单数组习惯编码为 `key[]`。
  - 非 2xx 响应优先解析 JSON 错误消息，失败时回退 `HTTP <status>`。

## Data Contract

- 初始数据来自 `post.polls` 与 `post.polls_votes`；`cooked` 中的 `.poll[data-poll-name]` 只用于定位和保留标题，不作为投票状态来源。
- Poll 名称优先读取占位元素的 `data-poll-name`，再与 `post.polls` 的 `name` 匹配；未匹配到权威 poll 数据时保留原占位，不伪造交互。
- 当前用户已选项来自 `post.polls_votes[poll.name]`，值为 option digest 数组。
- `PUT /polls/vote` 成功后：
  - 用响应中的 `poll` 合并更新 `post.polls` 里对应 poll。
  - 用响应中的 `vote` 更新 `post.polls_votes[poll.name]`。
  - 原位重渲染该 poll。
- `DELETE /polls/vote` 成功后：
  - 用响应中的 `poll` 合并更新对应 poll。
  - 删除 `post.polls_votes[poll.name]`。
  - 原位重渲染该 poll。

## Rendering

### Replacement

`renderPost()` 创建 `.ldp-post` 后调用 `renderPolls(node, post)`：

1. 查询 `.ldp-content` 内的 `.poll` 占位。
2. 对每个占位，用 `data-poll-name` 或默认 `poll` 名称查找 `post.polls`。
3. 仅当 poll 类型是 `regular` 或 `multiple` 且有选项数组时，替换为 `.ldp-poll`。
4. `number`、`ranked_choice`、缺数据或异常 poll 保持现有 cooked DOM，不额外实现功能。
5. 标题优先复制 cooked 内 `.poll-title` 的已净化 HTML；缺失时使用 poll 对象的 `title`。

### Result State

- 结果是否可见由服务端序列化结果决定：`poll.options` 中每个选项都有数字型 `votes` 时才显示票数、百分比、进度条和总人数。
- 这覆盖 `always`、`on_vote`、`on_close`、`staff_only` 等模式，并避免客户端越权判断。
- 用户已投票但结果不可见时，只显示选项与已选状态，不显示 `voters`。
- 已关闭状态由 `poll.status === 'closed'` 或有效的 `poll.close` 已过期判断；关闭后所有投票控件禁用。
- 多选边界按 Discourse `pollBounds`：
  - `min` 无效或小于 0 时取 1。
  - `max` 无效或大于选项数时取选项数。

### Option UI

- 每个选项渲染为 `button.ldp-poll-option`，携带 `data-option-id` 与 `aria-pressed`。
- 当前用户已选项加 `selected` 类。
- 结果可见时，每个选项内显示票数、百分比和进度条；进度条宽度为 `votes / voters * 100`，无投票人时为 0。
- 多选时显示“投票”或“更新投票”按钮，按钮在已选数量满足 `min/max` 前禁用，并显示已选数量提示。
- 已投票且允许修改时显示“撤销投票”按钮；关闭或请求中禁用。
- 请求状态和错误显示在 poll 区块内的 `.ldp-poll-status`，不使用 `alert()`。

## Interaction Flow

### Regular

1. 点击未选中选项：立即调用 `PUT /polls/vote`，`options` 为 `[optionId]`。
2. 点击当前已选选项：若允许修改，立即调用 `DELETE /polls/vote`，对齐 Discourse 原生行为。
3. 请求前设置区块 loading 状态并禁用控件；失败时保留点击前选择并显示行内错误。

### Multiple

1. 点击选项只切换本地 `selected` 类和 `aria-pressed`，不立即请求。
2. 每次切换后重新计算已选数量，并同步提交按钮禁用状态。
3. 点击“投票”或“更新投票”时，从当前 `selected` 选项读取 digest 数组并调用 `PUT /polls/vote`。
4. 请求失败时保留当前 DOM 选择，便于直接重试。

### State Refresh

- 成功后更新 `post` 中的 poll 与 votes，再替换对应 `.ldp-poll` 节点。
- 只替换当前 poll 节点，不重渲染整个 post，避免楼中楼、回复框、Boost、灯箱和已读 tracking 状态被破坏。
- 替换后的节点继续由弹框级事件委托处理，无需重新绑定监听。

## Event Handling

- 在 `bindActions()` 现有 spoiler、视频和链接逻辑之后、post 动作之前处理 poll 元素，避免 poll 内图片或链接被误判成普通内容操作。
- 识别选择器：
  - `.ldp-poll-option`
  - `.ldp-poll-submit`
  - `.ldp-poll-remove`
- 事件入口统一检查 `.ldp-poll[data-loading]`，请求中直接返回。
- post 对象优先通过 `ctx.postMap` 按楼层取，回退 `idToPost` 按 post id 取。

## Request Encoding And Errors

- `apiSend()` 对普通对象参数构建 `URLSearchParams`：
  - 标量使用 `append(key, value)`。
  - 数组逐项 `append(key + '[]', value)`。
- 投票请求使用 `options` 数组参数，实际表单为多个 `options[]` 字段。
- 非 2xx 响应先尝试 `res.json()`，从 `errors`、`error` 或 `message` 提取可读文本；解析失败保持现有 `HTTP <status>` 行为。
- 行内错误只用 `textContent` 写入，避免把接口响应当 HTML 插入。

## Styling And Accessibility

- 新增 `.ldp-poll`、`.ldp-poll-title`、`.ldp-poll-option`、`.ldp-poll-meta`、`.ldp-poll-bar`、`.ldp-poll-actions`、`.ldp-poll-status` 等样式。
- 样式沿用现有 `ldp-` 前缀、CSS 变量、8px 左右圆角和弹框内容排版，不引入外部 UI 框架。
- 选项按钮使用 `aria-pressed`；提交与撤销按钮为原生 `button` 并在请求或关闭时禁用。
- 选项 HTML、标题 HTML 来自 Discourse 已净化字段，可直接 `innerHTML`；数值和接口错误文本不拼进 HTML。

## Compatibility

- 所有 `renderPost()` 调用路径（主帖、分片楼层、楼中楼、新回复）都会经过同一个 poll 渲染函数。
- 不修改话题 JSON 获取、已读上报、点赞、回复、收藏或 Boost 的业务逻辑。
- `apiSend()` 的数组与错误解析对现有标量请求保持向后兼容。
- 不支持的 poll 类型保持当前静态 cooked 展示，不引入额外降级 UI。

## Rollback

- 本功能改动集中在 `LinuxDo 增强阅读.user.js` 的样式、工具函数、渲染函数和事件委托。
- 回滚只需恢复该文件到实现前版本；任务文档不参与运行时。
