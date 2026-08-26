/** `attachment` namespace dictionaries (this plugin's text-attachment copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'text.dropTitle': '文件拖动到此处即可添加',
  'text.dropBlocked': '当前无法添加文件',
  'text.pending': '待发送文本',
  'text.remove': '移除文本 {name}',
} satisfies Record<string, string>

/** The attachment namespace key union. */
export type AttachmentLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The attachment presentation plugin's own copy (text-file drafts). */
    attachment: AttachmentLocaleKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en: Record<AttachmentLocaleKey, string> = {
  'text.dropTitle': 'Drop files here to add them',
  'text.dropBlocked': 'Files cannot be added right now',
  'text.pending': 'Pending text files',
  'text.remove': 'Remove text {name}',
}
