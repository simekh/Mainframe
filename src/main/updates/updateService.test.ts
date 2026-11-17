import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateHow } from '../../shared/types';
import { changelogAt, howToUpdate, releaseRemote, remoteNewest, runningVersion } from './updateGit';
import { UpdateService } from './updateService';

// byHand only builds the commands, so it stays real.
vi.mock('./updateGit', async (importOriginal) => {
  const { byHand } = await importOriginal<typeof import('./updateGit')>();
  return { byHand, changelogAt: vi.fn(), howToUpdate: vi.fn(), releaseRemote: vi.fn(), remoteNewest: vi.fn(), runningVersion: vi.fn() };
});

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
    const { service, onChange } = make({ launcherFile: '/tmp/update' });
    expect(await service.check()).toEqual({ kind: 'available' });
    const view = await service.view();
    expect(view.current).toBe('0.4.0');
    expect(view.available).toEqual({ latest: '0.5.0', notes: '## 0.5.0 · 17 Nov\n\n- New: reorder projects', how: ONE_CLICK });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(view);
    expect(changelogAt).toHaveBeenCalledWith('/clone', 'origin', 'v0.5.0');
    expect(howToUpdate).toHaveBeenCalledWith('/clone', 'origin', 'v0.5.0');
  });

  it('makes one click by hand when start.mjs did not start the app', async () => {
    const { service } = make();
    await service.check();
    expect((await service.view()).available?.how).toEqual({
      kind: 'by-hand',
      why: 'not-launcher',
      commands: ['git fetch origin tag v0.5.0', 'git merge --ff-only v0.5.0', 'npm install', 'npm start'],
    });
  });

  it('makes one click by hand after a one-click update that did not finish', async () => {
    const { service } = make({ launcherFile: '/tmp/update', failure: 'npm install failed' });
    await service.check();
    expect((await service.view()).available?.how).toEqual({
      kind: 'by-hand',
      why: 'one-click-failed',
      commands: ['git fetch origin tag v0.5.0', 'git merge --ff-only v0.5.0', 'npm install', 'npm start'],
    });
  });

  it('keeps what git says when that is by hand already', async () => {
    vi.mocked(howToUpdate).mockResolvedValue(BY_HAND);
    const { service } = make();
    await service.check();
    expect((await service.view()).available?.how).toEqual(BY_HAND);
  });

  it.each([
    ['the same release', [0, 5, 0]],
    ['a newer release than the remote has', [0, 6, 1]],
  ] as const)('is up to date when the clone runs %s', async (_name, running) => {
    vi.mocked(runningVersion).mockResolvedValue([...running]);
    const { service, onChange } = make();
    expect(await service.check()).toEqual({ kind: 'up-to-date' });
    expect((await service.view()).available).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows an unreleased clone as null, and offers it every release', async () => {
    vi.mocked(runningVersion).mockResolvedValue(null);
    const { service } = make();
    expect(await service.check()).toEqual({ kind: 'available' });
    const view = await service.view();
    expect(view.current).toBeNull();
    expect(view.available?.notes).toContain('## 0.4.0');
  });

  it('says why it failed, and keeps the release it knew of', async () => {
    const { service, onChange } = make();
    await service.check();
    vi.mocked(remoteNewest).mockRejectedValue(new Error('could not reach origin'));
    expect(await service.check()).toEqual({ kind: 'failed', why: 'could not reach origin' });
    expect((await service.view()).available?.latest).toBe('0.5.0');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("says what git said, without the command line", async () => {
    const err = Object.assign(new Error('Command failed: git --no-optional-locks -C /clone ls-remote origin\nfatal: no such remote\n'), {
      code: 128,
      stderr: 'fatal: no such remote\n',
    });
    vi.mocked(remoteNewest).mockRejectedValue(err);
    expect(await make().service.check()).toEqual({ kind: 'failed', why: 'fatal: no such remote' });
  });

  it('says so plainly when the remote does not answer in time', async () => {
    const err = Object.assign(new Error('Command failed: git --no-optional-locks -C /clone ls-remote origin\n'), {
      killed: true,
      signal: 'SIGTERM',
      code: null,
      stderr: '',
    });
    vi.mocked(remoteNewest).mockRejectedValue(err);
    expect(await make().service.check()).toEqual({ kind: 'failed', why: "The remote didn't answer within 30 seconds." });
  });

  it('fails with its own words when the clone has no remote', async () => {
    vi.mocked(releaseRemote).mockResolvedValue(null);
    const { service } = make();
    expect(await service.check()).toEqual({ kind: 'failed', why: 'This copy of Mainframe has no git remote to check.' });
  });

  it('shows the failure start.mjs passed on, and checks at once for the commands to finish by hand', async () => {
    const { service } = make({ failure: 'git merge failed' });
    expect((await service.view()).failure).toBe('git merge failed');
    await vi.waitFor(() => expect(remoteNewest).toHaveBeenCalledTimes(1));
    expect((await make().service.view()).failure).toBeNull();
    expect(remoteNewest).toHaveBeenCalledTimes(1);
  });

  it('waits for the running version before it answers', async () => {
    let read!: (v: [number, number, number]) => void;
    vi.mocked(runningVersion).mockReturnValue(new Promise((resolve) => (read = resolve)));
    const view = make().service.view();
    read([0, 4, 0]);
    expect((await view).current).toBe('0.4.0');
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
    expect((await service.view()).available?.how).toEqual(BY_HAND);
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

  it('after an update that did not finish, checks at once, then every 6 hours', async () => {
    vi.useFakeTimers();
    const { service } = make({ failure: 'git merge failed' });
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteNewest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
    expect(remoteNewest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(remoteNewest).toHaveBeenCalledTimes(2);
    service.stop();
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
