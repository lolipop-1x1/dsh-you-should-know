# 领域文档

本项目采用 single-context 布局，以下约定用于工程技能探索代码和读取领域文档。

## 探索前读取

- 读取根目录的 `CONTEXT.md`。
- 若存在根目录 `CONTEXT-MAP.md`，先按其中的索引读取与当前主题相关的各个 `CONTEXT.md`。
- 读取 `docs/adr/` 中与当前改动相关的决策记录；若存在多上下文布局，也读取 `src/<context>/docs/adr/` 中的相关决策。

上述文件或目录不存在时，直接继续，不提示缺失，也不提前建议创建。`domain-modeling` 技能会在领域术语或决策明确后按需创建；`grill-with-docs` 和 `improve-codebase-architecture` 可调用它。

## 文件布局

- `CONTEXT.md`：项目的领域上下文和术语。
- `docs/adr/`：架构决策记录，例如 `0001-<decision>.md`。

## 使用领域术语

任务标题、重构方案、假设和测试名称等涉及领域概念时，使用 `CONTEXT.md` 定义的术语，避免替换为文档明确排除的同义词。

若概念尚未收录，先判断是否引入了项目没有使用的说法；若确实存在术语缺口，记录供 `domain-modeling` 处理。

## 显式指出决策冲突

输出与已有 ADR 冲突时，明确指出对应 ADR 和重新讨论的理由，不静默覆盖既有决策。
