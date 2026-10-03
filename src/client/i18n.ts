const zh = {
  learn: '展开解释', knew: '已经知道', dismiss: '关闭', understood: '已了解', chat: '带回主会话',
  helpful: '有帮助', irrelevant: '不相关', unclear: '未理解', waiting: '正在生成解释…',
  failed: '解释生成失败。', retry: '重试', draft: '请先发送或清空现有输入及附件。',
  changed: '输入已经变化，提醒未写入。', stale: '这条提醒已经变化，请重新选择。',
  error: '操作失败，请稍后重试。', feedback: '这条提醒对你有帮助吗？',
  enabled: '自动观察', follow: '跟随主会话模型', model: '观察模型', loading: '正在加载设置…',
  unavailable: '当前连接无法保存此设置。', saved: '设置已保存。', settingsError: '设置未保存，请重试。',
  usage: '自动观察会额外调用模型；即使没有展示提醒，也可能产生用量。默认使用完整会话上下文。',
  catalogError: '部分模型目录未能加载。', refresh: '刷新模型目录', heads: '注意事项', know: '值得了解',
  discuss: '以下是旁路观察者提出的事项。请结合当前任务讨论其含义与影响。',
  collapse: '收起提醒', open: '展开提醒',
  language: '语言', system: '跟随系统',
} as const
const en: Record<keyof typeof zh, string> = {
  learn: 'Learn more', knew: 'Knew this already', dismiss: 'Dismiss', understood: 'Understood', chat: 'Chat in main session',
  helpful: 'That was helpful', irrelevant: 'Not relevant', unclear: "Didn't understand", waiting: 'Writing an explanation…',
  failed: 'The explanation could not be generated.', retry: 'Retry', draft: 'Send or clear the existing draft and attachments first.',
  changed: 'The draft changed. The note was not inserted.', stale: 'This note changed. Select it again.',
  error: 'The action failed. Please retry.', feedback: 'Was this note helpful?',
  enabled: 'Automatic observation', follow: 'Follow the main session model', model: 'Observer model', loading: 'Loading settings…',
  unavailable: 'This connection cannot save this setting.', saved: 'Settings saved.', settingsError: 'Settings were not saved. Please retry.',
  usage: 'Observation makes extra model calls, including when no note is shown. Full conversation context is used by default.',
  catalogError: 'Some model catalogs could not be loaded.', refresh: 'Refresh model catalog', heads: 'Heads up', know: 'You should know',
  discuss: 'Here is a note from a side observer. Please discuss its meaning and impact on the current task.',
  collapse: 'Minimize note', open: 'Open note',
  language: 'Language', system: 'Follow system',
}
export type CopyKey = keyof typeof zh
export const copy = (locale: string, key: CopyKey): string => /^zh(?:-|$)/iu.test(locale) ? zh[key] : en[key]
