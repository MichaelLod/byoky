export type GetViews = (filter: { type: 'popup' | 'tab' }) => Window[];

/**
 * Whether popup.html is showing in a tab or a window of its own rather than
 * as the toolbar popup.
 *
 * The background opens popup.html in a 400x600 window where there is no side
 * panel (Firefox, Safari, Chrome without a tab id). That window has a real
 * viewport and wants the fluid layout. The toolbar popup
 * (chrome.action.openPopup, the Safari popover) sizes itself from its content
 * and needs the fixed size of html.popup. The browser's extension views say
 * which one this page is. A browser that can't say keeps the fixed size, which
 * never collapses.
 */
export function showsInTab(win: Window, getViews: GetViews | undefined): boolean {
  if (!getViews) return false;
  try {
    if (getViews({ type: 'popup' }).includes(win)) return false;
    return getViews({ type: 'tab' }).includes(win);
  } catch {
    return false;
  }
}
