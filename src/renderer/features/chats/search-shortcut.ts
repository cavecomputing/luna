type SearchKey = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>

export function isSearchShortcut(event: SearchKey): boolean {
  return !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'
}
