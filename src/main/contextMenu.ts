// The right-click menu of Windows and Linux; the Mac has none. Types only from `electron`, so a unit
// test never loads it.
import type { MenuItemConstructorOptions } from 'electron';

/**
 * Copy and Paste, for a right-click on something editable: a terminal, whose textarea xterm has just
 * focused and filled with the selection, the New task box or a note. Null elsewhere: no menu shows.
 */
export function editMenuItems(params: { isEditable: boolean; editFlags: { canCopy: boolean } }): MenuItemConstructorOptions[] | null {
  if (!params.isEditable) return null;
  return [{ role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste' }];
}

/** Copy alone, for the read-only diff page: only when text is selected, as there is nothing to paste into. */
export function copyMenuItems(params: { selectionText: string }): MenuItemConstructorOptions[] | null {
  return params.selectionText ? [{ role: 'copy' }] : null;
}
