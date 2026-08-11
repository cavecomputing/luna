export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_CONVERSATION_ATTACHMENT_BYTES = 50 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`
  const mib = kib / 1024
  return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`
}
