# 弹框支持 L 站投票实施计划

## Preconditions

- [x] 用户已明确批准最终规划摘要。
- [x] 已运行 `python3 ./.trellis/scripts/task.py start`，任务状态为 `in_progress`。

## Implementation Checklist

1. Baseline
   - [x] 记录当前 `git diff --check` 与 `node --check "LinuxDo 增强阅读.user.js"` 基线结果。
   - [x] 确认除本任务产物外的工作区改动不被触碰。
2. Request helper
   - [x] 为 `apiSend()` 增加数组参数的 `key[]` 编码。
   - [x] 为非 2xx JSON 响应提取可读错误消息，失败时保留 `HTTP <status>`。
   - [x] 验证现有标量请求的序列化字符串不含 `[]`。
3. Poll rendering
   - [x] 增加 poll 数据查找、边界计算、结果可见性和选项渲染辅助函数。
   - [x] 在 `renderPost()` 内替换 `regular` / `multiple` 的 cooked 占位。
   - [x] 保留不支持类型和缺数据 poll 的原 DOM。
   - [x] 新增投票区块 CSS。
4. Event handling
   - [x] 在 `bindActions()` 中加入选项切换、多选提交、撤销和 loading 防重入分支。
   - [x] 成功后更新 post 内 poll 与 votes，并原位替换 poll 节点。
   - [x] 失败时保留本地选择并显示行内错误。
5. Version and smoke
   - [x] 将 userscript 版本从 `1.8.3` 提升到 `1.8.4`。
   - [x] 检查所有新增选择器、函数名和 `ldp-` 前缀。

## Validation

```bash
node --check "LinuxDo 增强阅读.user.js"
git diff --check
git diff -- "LinuxDo 增强阅读.user.js"
```

- [x] 语法检查通过。
- [x] diff 检查通过。
- [x] 代码审查确认：
  - [x] poll 替换只发生在 `.ldp-content` 内。
  - [x] 不支持类型不会被替换。
  - [x] 结果可见性只依赖服务端返回的 `votes` 字段。
  - [x] 多选请求生成多个 `options[]`。
  - [x] 请求中与已关闭 poll 均禁用操作。
  - [x] 现有 `renderPost()` 调用路径和 `bindActions()` 行为未被无关重构。
- [x] 本地 Playwright DOM smoke test 通过：
  - [x] 模拟完整弹框打开流程后渲染 multiple poll。
  - [x] multiple 本地选择满足 `min/max` 后提交，成功后显示结果并变为“更新投票”。
  - [x] regular 点击未选项立即提交，成功后显示结果和当前选择。
  - [x] 请求体分别生成 `options[]=a&options[]=b` 与 `options[]=a`。
- [ ] 若本机浏览器会话可用，用用户提供的 `https://linux.do/t/topic/2926838` 做手工验证：
  - [ ] 打开弹框可见 poll。
  - [ ] 单选提交、更新和撤销可用。
  - [ ] 多选 `min/max` 与提交状态正确。
  - [ ] 结果条、总人数和当前选择更新正确。
  - [ ] 原有点赞、回复、收藏和分片加载入口仍可用。
- [x] 线上验证未完成：公开 HTML 返回 404，JSON API 被 Cloudflare challenge 拦截，且本机浏览器控制会话启动失败；不以假结果关闭任务。

## Review Gates

- 实现后运行 `trellis-check` 流程，先完成静态检查，再做可行的浏览器验证。
- 发现需求或行为偏差时回到 PRD/design 修正，再继续实现。
- 验证通过后按仓库现有提交风格提交 userscript 功能变更。

## Rollback Points

- 请求 helper、渲染、事件处理和样式均在同一 userscript 文件内；需要回滚时只恢复该文件，不回滚用户已有的无关未跟踪文件。
