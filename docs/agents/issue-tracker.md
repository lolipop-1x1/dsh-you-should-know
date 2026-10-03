# Issue tracker：本地 Markdown

本项目的规格和任务以 Markdown 文件保存在 `.scratch/` 中。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格文件：`.scratch/<feature-slug>/spec.md`。
- 实现任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 编号，每个任务独立一个文件，不合并成单个任务列表。
- 在任务文件顶部附近用 `Status:` 记录 triage 状态，状态字符串见 `triage-labels.md`。
- 评论和讨论历史追加到文件底部的 `## Comments` 下。

## 当技能要求“发布到 issue tracker”

按上述约定在 `.scratch/<feature-slug>/` 下创建对应文件，目录不存在时再创建。

## 当技能要求“获取相关任务”

读取用户提供路径或编号对应的任务文件。

## Wayfinder 操作约定

- 地图文件：`.scratch/<effort>/map.md`，记录 Notes、Decisions-so-far 和 Fog。
- 子任务文件：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号，正文记录问题。
- `Type:` 记录任务类型：`research`、`prototype`、`grilling` 或 `task`。
- Wayfinder 的 `Status:` 使用工作流状态：待领取任务为 `open`，领取后为 `claimed`，解决后为 `resolved`。这些状态与 triage 分类状态分别用于各自工作流。
- 依赖关系写在顶部附近的 `Blocked by: NN, NN` 中；所有依赖均为 `resolved` 后，任务才解除阻塞。
- 按编号选择第一个状态为 `open`、未阻塞且未领取的任务。
- 开始工作前，先将 `Status:` 改为 `claimed` 并保存。
- 完成后在 `## Answer` 下追加答案，将状态改为 `resolved`，并向地图的 Decisions-so-far 追加结论摘要和任务链接。
