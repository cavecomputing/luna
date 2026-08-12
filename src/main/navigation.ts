export function canFrameLoad(url: string, isMainFrame: boolean): boolean {
  if (isMainFrame || url === 'about:blank') return true
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'app:' &&
      parsed.hostname === 'preview' &&
      parsed.port === '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      /^\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.pathname,
      )
    )
  } catch {
    return false
  }
}
