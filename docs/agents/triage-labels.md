# Triage 状态映射

本项目使用默认的五个 triage 状态，通过本地任务文件的 `Status:` 行记录。

| 技能中的角色 | 本项目的状态字符串 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 等待维护者评估 |
| `needs-info` | `needs-info` | 等待补充信息 |
| `ready-for-agent` | `ready-for-agent` | 规格完整，可交给 Agent 执行 |
| `ready-for-human` | `ready-for-human` | 需要人工实现 |
| `wontfix` | `wontfix` | 不予处理 |

技能提到某个 triage 角色时，使用表中对应的状态字符串。
如需更换命名，直接修改第二列。
