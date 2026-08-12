/**
 * Applies the stored theme to this window and keeps it current.
 *
 * The Luna pair rides prefers-color-scheme, which main drives through
 * nativeTheme — nothing to do here. Named themes beyond that pair (the
 * Gruvbox themes) are pinned on <html data-theme>, where the attribute
 * selectors in tokens.css take over. Called once per entry, before render;
 * the prefs broadcast keeps every window in step after that.
 */
export function watchTheme(): void {
  const pin = (theme: string): void => {
    document.documentElement.dataset.theme = theme
  }

  void window.luna.prefs.get().then((r) => {
    // A failed read (e.g. the recovery window over a broken database) leaves
    // the default Luna pair in charge.
    if (r.ok) pin(r.value.theme)
  })

  window.luna.onPrefs((next) => {
    pin(next.theme)
  })
}
