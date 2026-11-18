import { createSignal } from 'solid-js';
import type { SettingsView } from '../../../shared/types';
import { errorMessage } from '../bridgeError';
import { setupView } from '../setup/setupStore';

/** What Settings shows, for the whole app; undefined until main has answered, which it does once the projects start. */
const [view, setView] = createSignal<SettingsView | undefined>(undefined);
export const settingsView = view;

const [open, setOpen] = createSignal(false);
export const settingsOpen = open;
export const closeSettings = () => setOpen(false);

window.mainframe.onSettings(setView);

/** Main answers only once the projects have started. */
export const loadSettings = (): Promise<void> =>
  window.mainframe.getSettings().then((next) => void setView(next), (err: unknown) => console.error(`[settings] could not get the settings: ${errorMessage(err)}`));

/** Not over the setup screen, which has no Settings, nor over another dialog. */
export function openSettings(): void {
  if (setupView() !== null || document.querySelector('dialog:modal')) return;
  setOpen(true);
}

window.mainframe.onShowSettings(openSettings);
