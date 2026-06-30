# LinuxDo 增强阅读 · 帖子弹窗预览脚本

> 在 LINUX DO 列表页点击标题即可弹窗预览整帖，楼中楼展示、点赞、回复、收藏、原图灯箱一应俱全，并按真实阅读节奏上报已读进度——无需离开列表页，也无需反复返回。

[![](https://img.shields.io/badge/github-repo-blue?logo=github)](https://github.com/fashionzzZ/linuxdo-read-script)
![version](https://img.shields.io/badge/version-1.0.2-blue)
![platform](https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey-orange)
![license](https://img.shields.io/badge/license-MIT-green)

## 简介

[LINUX DO](https://linux.do) 基于 Discourse 构建。本脚本利用 Discourse 官方 JSON 接口，在话题列表页拦截标题点击，以**弹窗**形式直接预览帖子内容，避免频繁跳转与"返回即刷新、丢失浏览位置"的困扰。所有交互（点赞、回复、收藏、已读）均通过官方接口完成，沿用浏览器现有登录态。

## 功能特性

- **标题弹窗预览**：点击列表标题（含右上角用户菜单/通知面板中的话题链接）即在当前页弹窗打开，不跳转。
- **楼中楼评论**：依据 `reply_to_post_number` 还原嵌套回复结构，缩进展示父子关系。
- **滚动分页加载**：基于 `post_stream.stream` 分块按需加载，长帖首屏更快；底部哨兵 + `IntersectionObserver` 自动续加载。
- **点赞 / 取消赞**：显示点赞数，支持一键点赞与取消（取消受 Discourse 时间窗限制）。
- **楼内回复**：可对任意楼层回复，发送后即时插入为该楼的楼中楼子节点。
- **整帖收藏 / 取消收藏**：调用 Discourse 书签接口。
- **原图灯箱**：点击正文图片以原图地址（外层 `a.lightbox` 的 `href`）打开灯箱；点图片、点空白、按 Esc、点右上角 × 均可关闭。
- **OP / ME 标识**：楼主所有楼层标注蓝色 `OP`，本人楼层标注绿色 `ME`。
- **打开原帖**：头部一键在新标签页打开帖子原始页面。
- **已读上报**：仅对**滚动进入视口并停留足够时间**的楼层，按真实阅读节奏调用 `topics/timings` 上报，使弹窗阅读也能计入 Connect 进度。

## 安装

1. 安装用户脚本管理器：[Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. [安装脚本](https://update.greasyfork.org/scripts/584412/LinuxDo%20%E5%A2%9E%E5%BC%BA%E9%98%85%E8%AF%BB.user.js)
3. 刷新 `https://linux.do` 任意页面即可生效。

## 使用说明

| 操作 | 效果 |
| --- | --- |
| 点击列表标题 | 弹窗预览该帖 |
| 滚动弹窗 | 自动加载后续楼层，并按停留时长上报已读 |
| 点击图片 | 原图灯箱查看，再次点击/Esc 关闭 |
| ♥ 按钮 | 点赞 / 取消赞 |
| ↩ 回复 | 展开回复框，发送后插入楼中楼 |
| ☆ 收藏本帖 | 收藏 / 取消收藏整帖 |
| ↗ 打开原帖 | 新标签页打开原始帖子页面 |
| Esc / 点击遮罩 / × | 关闭弹窗 |

## 配置项

脚本顶部提供可调常量：

```js
const PAGE_SIZE = 20;          // 每次分块加载的楼层数
const READ_THRESHOLD = 1500;   // 单楼累计可见超过该毫秒数才算"读过"
const FLUSH_INTERVAL = 5000;   // 已读增量上报间隔（毫秒）
```

想更保守地上报已读，可调大 `READ_THRESHOLD`（如 `3000`）。

## 工作原理

- **数据获取**：`GET /t/{id}.json` 取首屏与完整 `post_stream.stream`，缺失楼层用 `GET /t/{id}/posts.json?post_ids[]=...` 分批补齐。
- **楼中楼**：以楼层号建立映射，按 `reply_to_post_number` 挂到父节点；跨分块未就绪的父级先暂存，块加载完后回扫归位。
- **已读上报**：用 `IntersectionObserver` 记录楼层进入/离开视口的时间戳累计停留时长，达阈值后通过 `POST /topics/timings`（带 `topic_time`、`timings[楼层]=毫秒`）增量上报；切后台自动暂停计时，避免虚增。
- **交互接口**：点赞 `POST/DELETE /post_actions`、回复 `POST /posts`、收藏 `POST/DELETE /bookmarks`，均携带 `X-CSRF-Token`。

## ⚠️ 风控与使用须知

已读上报本质上是程序化提交阅读数据，LINUX DO 对**异常自动化访问**有风控机制。本脚本已尽量贴近真人节奏（按可见性、按停留阈值、增量上报、后台不计时），正常浏览强度下风险较低。但请勿配合任何脚本批量、高频地刷帖，否则可能被判定为异常访问，导致统计不计入甚至账号风险。**请按正常阅读节奏使用，风险自负。**

本脚本不生成、不代写任何用于发布到社区的内容；回复功能仅转发你本人手动输入的文字。

## 兼容性

- 适用于基于 Discourse 的 `https://linux.do`（`@match https://linux.do/*`）。
- 依赖现代浏览器特性：`fetch`、`IntersectionObserver`、`URLSearchParams`。
- 大部分功能需登录后才能成功调用（点赞、回复、收藏、已读上报）。

## 常见问题

**Q：点击通知面板里的帖子没反应？**
A：不同 Discourse 版本的用户菜单 DOM 结构不同，可在脚本第 11 节的 `MENU_PANEL_SEL` 中补充该面板的实际容器类名。

**Q：图片没按原图显示？**
A：脚本优先取外层 `a.lightbox` 的 `href` 作为原图；若某图无该外层链接，会回退到 `src` 显示。

**Q：已读没生效？**
A：确认已登录，且该楼确实滚动进入视口并停留超过 `READ_THRESHOLD`；后台标签页不计时。

## 许可证

[MIT](./LICENSE)

## 免责声明

本项目为个人学习与效率工具，与 LINUX DO 官方无关。使用本脚本所产生的一切后果由使用者自行承担。

