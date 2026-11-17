import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateHow } from '../../shared/types';
import { changelogAt, howToUpdate, releaseRemote, remoteNewest, runningVersion } from './updateGit';
import { UpdateService } from './updateService';

vi.mock('./updateGit');

const CHANGELOG = '# Changelog\n\n## Unreleased\n\n## 0.5.0 · 17 Nov\n\n- New: reorder projects\n\n## 0.4.0 · 1 Nov\n\n- Old\n';
const ONE_CLICK: UpdateHow = { kind: 'one-click' };
const BY_HAND: UpdateHow = { kind: 'by-hand', why: 'uncommitted', commands: ['git fetch origin tag v0.5.0'] };

function make(over: { launcherFile?: string; failure?: string } = {}) {
  const onChange = vi.fn();
  const requestQuit = vi.fn();
  const service = new UpdateService({
    dir: '/clone',
    launcherFile: over.launcherFile,
    failure: over.failure,
    onChange,
    requestQuit,
  });
  return { service, onChange, requestQuit };
}

beforeEach(() => {
  vi.mocked(runningVersion).mockResolvedValue([0, 4, 0]);
  vi.mocked(releaseRemote).mockResolvedValue('origin');
  vi.mocked(remoteNewest).mockResolvedValue([0, 5, 0]);
  vi.mocked(changelogAt).mockResolvedValue(CHANGELOG);
  vi.mocked(howToUpdate).mockResolvedValue(ONE_CLICK);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('UpdateService.check', () => {
  it('finds a newer release, with the notes since the running version, and says so once', async () => {
    const { service, onChange } = make();
    expect(await service.check()).toEqual({ kind: 'available' });
    const view = service.view();
    expect(view.current).toBe('0.4.0');
    expect(view.available).toEqual({ latest: '0.5.0', notes: '## 0.5.0 · 17 Nov\n\n- New: reorder projects', how: ONE_CLICK });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(view);
    expect(changelogAt).toHaveBeenCalledWith('/clone', 'origin', 'v0.5.0');
    expect(howToUpdate).toHaveBeenCalledWith('/clone', 'origin', 'v0.5.0', false);
  });

  it('asks how to update as a launched app when start.mjs named its file', async () => {
    const { service } = make({ launcherFile: '/tmp/update' });
    await service.check();
    expect(howToUpdate).toHaveBeenCalledWith('/clone', 'origin', 'v0.5.0', true);
  });

  it.each([
    ['the same release', [0, 5, 0]],
    ['a newer release than the remote has', [0, 6, 1]],
  ] as const)('is up to date when the clone runs %s', async (_name, running) => {
    vi.mocked(runningVersion).mockResolvedValue([...running]);
    const { service, onChange } = make();
    expect(await service.check()).toEqual({ kind: 'up-to-date' });
    expect(service.view().available).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows an unreleased clone as null, and offers it every release', async () => {
    vi.mocked(runningVersion).mockResolvedValue(null);
    const { service } = make();
    expect(await service.check()).toEqual({ kind: 'available' });
    expect(service.view().current).toBeNull();
    expect(service.view().available?.notes).toContain('## 0.4.0');
  });

  it('says why it failed, and keeps the release it knew of', async () => {
    const { service, onChange } = make();
    await service.check();
    vi.mocked(remoteNewest).mockRejectedValue(new Error('could not reach origin'));
    expect(await service.check()).toEqual({ kind: 'failed', why: 'could not reach origin' });
    expect(service.view().available?.latest).toBe('0.5.0');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('fails with its own words when the clone has no remote', async () => {
    vi.mocked(releaseRemote).mockResolvedValue(null);
    const { service } = make();
    expect(await service.check()).toEqual({ kind: 'failed', why: 'This copy of Mainframe has no git remote to check.' });
  });

  it('shows the failure start.mjs passed on', () => {
    expect(make({ failure: 'git merge failed' }).service.view().failure).toBe('git merge failed');
    expect(make().service.view().failure).toBeNull();
  });
});

describe('UpdateService.install', () => {
  it('writes the tag for start.mjs and quits, when one click works', async () => {
    const launcherFile = join(mkdtempSync(join(tmpdir(), 'mf-update-')), 'update');
    const { service, requestQuit } = make({ launcherFile });
    await service.check();
    await service.install();
    expect(readFileSync(launcherFile, 'utf8')).toBe('v0.5.0');
    expect(requestQuit).toHaveBeenCalledTimes(1);
  });

  it('asks again how, and refuses without writing when it must be done by hand', async () => {
    const launcherFile = join(mkdtempSync(join(tmpdir(), 'mf-update-')), 'update');
    const { service, requestQuit } = make({ launcherFile });
    await service.check();
    vi.mocked(howToUpdate).mockResolvedValue(BY_HAND);
    await expect(service.install()).rejects.toThrow();
    expect(existsSync(launcherFile)).toBe(false);
    expect(requestQuit).not.toHaveBeenCalled();
    expect(service.view().available?.how).toEqual(BY_HAND);
  });

  it('refuses when no release is known', async () => {
    const { service, requestQuit } = make({ launcherFile: '/nowhere/update' });
    await expect(service.install()).rejects.toThrow();
    expect(requestQuit).not.toHaveBeenCalled();
  });
});

describe('UpdateService.start', () => {
  it('checks 10 s after start, then every 6 hours, until stopped', async () => {
    vi.useFakeTimers();
    const { service } = make();
    service.start();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(remoteNewest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(remoteNewest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
    expect(remoteNewest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(remoteNewest).toHaveBeenCalledTimes(2);
    service.stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(remoteNewest).toHaveBeenCalledTimes(2);
  });

  it('stops before the first check too', async () => {
    vi.useFakeTimers();
    const { service } = make();
    service.start();
    service.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(remoteNewest).not.toHaveBeenCalled();
  });
});
