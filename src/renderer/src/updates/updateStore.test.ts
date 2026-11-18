import { beforeEach, expect, it, vi } from 'vitest';
import type { CheckResult, UpdateView } from '../../../shared/types';

/** The main process's side of the bridge: what a test's check and getUpdate answer. */
const bridge = {
  checkForUpdates: vi.fn<() => Promise<CheckResult>>(),
  getUpdate: vi.fn<() => Promise<UpdateView>>(),
};

vi.stubGlobal('window', {
  mainframe: {
    checkForUpdates: () => bridge.checkForUpdates(),
    getUpdate: () => bridge.getUpdate(),
    onUpdate: () => {},
    onCheckForUpdates: () => {},
  },
});

const { checkNow, closeUpdateDialog, updateFace, updateView } = await import('./updateStore');

beforeEach(() => {
  closeUpdateDialog();
  bridge.checkForUpdates.mockReset();
  bridge.getUpdate.mockReset();
});

it('opens the failed face when the check itself rejects', async () => {
  bridge.checkForUpdates.mockRejectedValue(new Error("Error invoking remote method 'x': Error: gone"));
  await checkNow();
  expect(updateFace()).toEqual({ kind: 'failed', why: 'gone' });
});

it('refreshes the view before showing a release the check found', async () => {
  const view: UpdateView = { current: '0.1.0', available: { latest: '0.2.0', notes: '', how: { kind: 'one-click' } }, failure: null };
  bridge.checkForUpdates.mockResolvedValue({ kind: 'available' });
  bridge.getUpdate.mockResolvedValue(view);
  await checkNow();
  expect(updateView()).toEqual(view);
  expect(updateFace()).toEqual({ kind: 'available' });
});
