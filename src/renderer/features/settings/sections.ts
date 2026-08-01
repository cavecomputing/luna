/** The Settings sections, in order. Adding one means adding a line here. */
export const sections = [
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'chat', label: 'Chat' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'about', label: 'About' },
] as const

export type SectionId = (typeof sections)[number]['id']
