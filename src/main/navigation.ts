export function canFrameLoad(url: string, isMainFrame: boolean): boolean {
  return isMainFrame || url === 'about:blank' || url === 'about:srcdoc'
}
