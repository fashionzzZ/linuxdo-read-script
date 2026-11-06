# 弹窗用户头像资料卡

## Goal

用户在增强阅读弹窗中阅读帖子时，点击任意楼层或 Boost 的用户信息（头像、昵称或用户名）即可查看该用户的资料卡，信息结构对齐 LINUX DO 官方用户卡片，无需跳转到个人主页。

## Requirements

- 点击弹窗内帖子头部的用户链接（头像、昵称、`@用户名`）或 Boost 头像时打开资料卡。
- 资料卡锚定在头像附近，优先显示在头像下方，空间不足时翻转到上方，并限制在弹窗可视范围内。
- 资料卡打开时立即展示已知基础信息：头像、昵称、`@用户名`、信任等级。
- 请求 `GET /u/{username}/card.json` 后补充展示：
  - 用户头衔（`title`）。
  - 简介（`bio_excerpt`）。
  - 所在地与个人网站（`location`、`website`）。
  - 加入时间、最近活跃时间、累计阅读时长。
  - 精选徽章（`featured_user_badges` / `user_badges`）。
  - “查看资料”入口，跳转 `/u/{username}/summary`。
- 资料卡根据用户的 `is_followed` / `can_follow` 展示“关注”或“取消关注”按钮；`is_followed` 为真或 `can_follow` 为真时显示。
- 点击关注按钮调用 Follow 插件接口：关注使用 `PUT /follow/{username}.json`，取消关注使用 `DELETE /follow/{username}.json`；请求期间禁用按钮，成功后更新按钮、缓存状态，失败时保留原状态并显示行内错误。
- 请求期间保留基础信息并显示加载提示；请求失败时显示轻量错误提示，不阻断用户关闭资料卡或打开个人主页。
- 同一时间最多显示一个资料卡；再次点击同一用户链接、点击卡片外部、按 Esc、滚动弹窗、调整窗口大小或关闭弹窗时关闭资料卡。
- Esc 优先关闭资料卡，不应同时关闭外层帖子弹窗。
- 同一用户的资料在本次页面会话内缓存，避免重复请求。
- 样式沿用 LINUX DO 官方用户卡的信息层级与 Discourse 主题 CSS 变量，保持深浅色主题兼容；所有新增样式使用 `ldp-` 前缀，不引入外部 UI 库。
- 弹窗内已访问过的帖子用户链接保持正常文字颜色，hover 时仍显示主题色；资料卡昵称访问后保持 `var(--primary)`。
- 资料卡“查看资料”按钮在已访问及已访问 hover 状态保持白色文字，normal hover 的亮度反馈不变。
- 资料卡内容中的文本字段必须转义；`bio_excerpt` 仅作为 Discourse 已净化 HTML 渲染，链接统一新标签页打开。

## Out of Scope

- 发送私信、聊天、屏蔽、禁言等用户操作。
- 用户主页摘要页、话题/回复列表、获赞明细等完整资料页内容。
- 用户卡片背景图、状态表情、在线状态轮询。
- 为卡片单独实现移动端底部抽屉。

## Acceptance Criteria

- [x] 点击帖子头像、昵称或 `@用户名` 后，在头像附近出现资料卡，并立即显示头像、昵称、用户名和等级。
- [x] 资料加载成功后展示头衔、简介、所在地/网站、加入时间、最近活跃、阅读时长和徽章。
- [x] 资料加载失败时基础信息仍可用，并显示可理解的错误状态。
- [x] 点击 Boost 头像同样打开对应用户的资料卡。
- [x] 点击同一用户链接、点击外部、按 Esc、滚动弹窗或关闭弹窗均能关闭资料卡，且 Esc 不会误关外层弹窗。
- [x] 资料卡不会超出弹窗外框，空间不足时能翻转或收缩。
- [x] 资料卡中的“查看资料”入口在新标签页打开个人主页。
- [x] 可按官方 Follow 插件规则显示关注/取消关注按钮，成功后同一会话内再次打开资料卡仍保留最新状态。
- [x] 关注请求失败时按钮状态不变，并在资料卡内显示错误提示。
- [x] 深浅色主题下文字、背景、边框和徽章均清晰可读。
- [x] 已访问用户链接不显示站点的 visited 颜色，hover 与资料卡昵称颜色符合预期。
- [x] 资料卡“查看资料”按钮在已访问及已访问 hover 状态保持白色文字。
- [x] 原有点赞、回复、Boost、收藏、投票、灯箱、分片加载和已读上报功能不回归。

## Background

- 本仓库是单文件用户脚本 `LinuxDo 增强阅读.user.js`，弹窗 DOM 由脚本自行渲染，主题变量来自 LINUX DO 页面。
- `renderPost()` 生成帖子头部的用户链接（头像、昵称、用户名）；`renderBoosts()` 生成 Boost 气泡头像；`bindActions()` 统一处理弹窗内点击事件。
- Discourse 用户卡接口为 `GET /u/{username}/card.json`，返回根字段 `user`。可用字段包括 `avatar_template`、`username`、`name`、`trust_level`、`title`、`bio_excerpt`、`location`、`website`、`created_at`、`last_seen_at`、`time_read`、`badge_count`、`featured_user_badges` 等。
- 徽章数据可能以完整对象、`user_badges` 侧载数组或 ID 数组形式返回，渲染前需要兼容归一化。
- Follow 插件在 `card.json` 的 `user` 中提供 `can_follow`、`is_followed`；关注接口为 `PUT /follow/{username}.json`，取消关注接口为 `DELETE /follow/{username}.json`。
- 弹窗遮罩层 `.ldp-overlay` 的 `z-index` 为 `2147483000`，灯箱为 `2147483600`；资料卡应位于弹窗之上、灯箱之下。
