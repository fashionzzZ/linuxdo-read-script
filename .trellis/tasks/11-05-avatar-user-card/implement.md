# 弹窗用户头像资料卡实施计划

## Preconditions

- [x] 用户已批准任务创建与规划方向。
- [x] 已运行 `python3 ./.trellis/scripts/task.py start`，任务状态为 `in_progress`。
- [x] 已确认本任务外的未跟踪 `.ai-stats/` 不触碰，工作区其余改动均属于本任务。

## Implementation Checklist

1. Baseline
   - [x] 记录 `node --check "LinuxDo 增强阅读.user.js"` 与 `git diff --check` 基线。
2. Data and rendering
   - [x] 为帖子用户链接和 Boost 头像补充 `data-username` / `data-name`。
   - [x] 新增用户资料卡请求缓存、字段归一化、徽章收集与时间格式化函数。
   - [x] 实现基础卡片渲染与异步资料补全，失败时显示行内错误。
   - [x] 添加 `.ldp-uc-*` 样式，覆盖深浅色主题与窄屏宽度。
   - [x] 根据 `can_follow` / `is_followed` 展示关注按钮，接入 Follow 插件接口并同步缓存状态。
3. Interaction and lifecycle
   - [x] 在 `bindActions()` 中优先拦截帖子用户链接（头像/昵称/用户名）和 Boost 头像点击。
   - [x] 实现定位、翻转、边界收缩与重新定位。
   - [x] 实现点击外部、Esc、滚动、resize 和弹窗关闭时的清理。
   - [x] 确保 Esc 只关闭资料卡，不关闭外层弹窗。
4. Documentation and version
   - [x] userscript 版本从 `1.8.8` 提升到 `1.9.1`。
   - [x] 修复弹窗内已访问用户链接被站点 `a:visited` 覆盖的问题，版本提升到 `1.9.2`。
   - [x] 修复资料卡“查看资料”按钮在 `:visited` 状态文字变色的问题，版本提升到 `1.9.3`。
   - [x] README 版本徽章更新，并补充用户资料卡功能说明。
5. Validation
   - [x] `node --check "LinuxDo 增强阅读.user.js"`。
   - [x] `git diff --check`。
   - [x] 本地 DOM 冒烟测试通过（`node /tmp/ldp-test/smoke.js` 输出 `SMOKE_OK`）。
   - [x] 本地 DOM 冒烟测试：打开弹窗 → 分别点击头像、昵称、用户名 → 断言资料卡出现、字段正确、Esc 关闭卡片且弹窗仍在 → 再按 Esc 关闭弹窗；同时覆盖 Boost 头像、接口失败、滚动/resize 关闭、Ctrl 点击和真实 Discourse 徽章侧载结构。
   - [x] 关注冒烟：关注/取消关注的方法与 URL、按钮文案切换、关闭重开后状态保留、请求失败状态不变且显示错误、不可关注时按钮隐藏。
   - [x] 静态复核：无 XSS 拼接、无残留监听器、原链接行为未变。

## Validation Commands

```bash
node --check "LinuxDo 增强阅读.user.js"
git diff --check
git diff -- "LinuxDo 增强阅读.user.js" README.md
```

## Review Gates

- 实现后按 `trellis-check` 清单完成自检、静态复核与本地 DOM 冒烟。
- 若卡片布局或字段与 L 站实际响应不符，回到本任务 PRD/design 修正后再继续。
- 验证通过后由用户确认是否提交 userscript 功能变更。

## Rollback Points

- 样式、数据、交互均在单个 userscript 文件内；需要回滚时只恢复该文件，不触碰用户已有无关改动。

## Verification Notes

- 本地 DOM 冒烟测试使用与 `meta.discourse.org/u/{username}/card.json` 相同的字段与徽章侧载结构，覆盖头像/昵称/用户名、Boost 头像、失败态、Esc 层级、外部点击、滚动/resize 关闭和 Ctrl 点击。
- 线上 `linux.do` 直接请求被 Cloudflare 403 拦截，未做真实站点手测；需在已登录浏览器中刷新脚本后做最终确认。
- 已访问链接样式使用 `.ldp-overlay` 作用域覆盖，包含资料卡“查看资料”按钮的 `:visited` 与 `:visited:hover`，不影响弹窗外的站点链接。
- 使用本地临时页面与 Chrome 真实访问历史验证：对照链接进入 `:visited` 紫色状态时，资料卡“查看资料”按钮仍为白字。
- 代码与文档改动尚未提交，等待用户确认是否按仓库风格提交。
