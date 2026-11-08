import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectView } from '../shared/types';
import { ProjectRegistry, type RegisteredProject } from './projectRegistry';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(os.tmpdir(), 'mainframe-registry-'));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const ACME = '/work/acme';
const GLOBEX = '/work/globex';

function fakeSessions(ids: string[]) {
  const running = new Set(ids);
  return { sessionIds: () => [...running], beginQuit: vi.fn() };
}

type Fake = RegisteredProject & { service: ReturnType<typeof fakeSessions>; manager: ReturnType<typeof fakeSessions> };

function fakeProject({ tasks = [] as string[], manager = [] as string[] } = {}): Fake {
  return { service: fakeSessions(tasks), manager: fakeSessions(manager), start: vi.fn(), release: vi.fn(async () => {}) };
}

/**
 * A registry whose projects come from `made`, over a session host where a session ends `exitMs` after
 * its hangup, or `killMs` after it is killed outright.
 */
function setup({ made = {} as Record<string, () => Fake>, exitMs = 0, killMs = 0, closeTimeoutMs = 1000, dir = dataDir } = {}) {
  const host = new Set<string>();
  const killed: string[] = [];
  const changes: ProjectView[][] = [];
  const open = vi.fn(async (dir: string) => {
    const project = (made[dir] ?? fakeProject)();
    for (const id of [...project.service.sessionIds(), ...project.manager.sessionIds()]) host.add(id);
    return project;
  });
  const registry = new ProjectRegistry<Fake>({
    dataDir: dir,
    open,
    kill: (id, signal) => {
      killed.push(signal ? `${id} ${signal}` : id);
      setTimeout(() => host.delete(id), signal ? killMs : exitMs);
    },
    running: (id) => host.has(id),
    onChange: (projects) => changes.push(projects),
    closeTimeoutMs,
  });
  const remembered = () => JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')).open;
  return { registry, open, killed, host, changes, remembered };
}

it('opens a project, remembers it, says so, and starts it once it is registered', async () => {
  const project = fakeProject();
  const { registry, changes, remembered } = setup({ made: { [ACME]: () => project } });
  vi.mocked(project.start).mockImplementation(() => expect(registry.get(ACME)).toBe(project));

  await registry.open(ACME);

  expect(registry.list()).toEqual([{ dir: ACME, name: 'acme' }]);
  expect(remembered()).toEqual([ACME]);
  expect(changes).toEqual([[{ dir: ACME, name: 'acme' }]]);
  expect(project.start).toHaveBeenCalledOnce();
});

it('lists the projects in the order they were opened', async () => {
  const { registry, remembered } = setup();
  await registry.open(GLOBEX);
  await registry.open(ACME);
  expect(registry.list().map((p) => p.dir)).toEqual([GLOBEX, ACME]);
  expect(remembered()).toEqual([GLOBEX, ACME]);
});

it('opens a project that is open already, or being opened, only once', async () => {
  const { registry, open, changes } = setup();
  await Promise.all([registry.open(ACME), registry.open(ACME)]);
  await registry.open(ACME);
  expect(open).toHaveBeenCalledOnce();
  expect(changes).toHaveLength(1);
});

it('registers and remembers nothing when a project cannot be opened', async () => {
  const { registry, changes } = setup({
    made: {
      [ACME]: () => {
        throw new Error('no port');
      },
    },
  });
  await expect(registry.open(ACME)).rejects.toThrow('no port');
  expect(registry.list()).toEqual([]);
  expect(changes).toEqual([]);
  await registry.open(GLOBEX);
  expect(registry.list().map((p) => p.dir)).toEqual([GLOBEX]);
});

it('finds the task service or the manager that runs a session', async () => {
  const acme = fakeProject({ tasks: ['t1'], manager: ['m1'] });
  const globex = fakeProject({ tasks: ['t2'] });
  const { registry } = setup({ made: { [ACME]: () => acme, [GLOBEX]: () => globex } });
  await registry.open(ACME);
  await registry.open(GLOBEX);

  expect(registry.ownerOf('t1')).toBe(acme.service);
  expect(registry.ownerOf('m1')).toBe(acme.manager);
  expect(registry.ownerOf('t2')).toBe(globex.service);
  expect(registry.ownerOf('nobody')).toBeUndefined();
});

it('closes a project: its sessions end as they do at Quit, then it lets go of the rest', async () => {
  const acme = fakeProject({ tasks: ['t1', 't2'], manager: ['m1'] });
  const { registry, killed, host, changes, remembered } = setup({ made: { [ACME]: () => acme }, exitMs: 20 });
  await registry.open(ACME);
  await registry.open(GLOBEX);
  vi.mocked(acme.release).mockImplementation(async () => expect([...host]).toEqual([]));

  await registry.close(ACME);

  expect(acme.service.beginQuit).toHaveBeenCalledOnce();
  expect(acme.manager.beginQuit).toHaveBeenCalledOnce();
  expect(killed).toEqual(['t1', 't2', 'm1']);
  expect(acme.release).toHaveBeenCalledOnce();
  expect(registry.get(ACME)).toBeUndefined();
  expect(registry.list().map((p) => p.dir)).toEqual([GLOBEX]);
  expect(remembered()).toEqual([GLOBEX]);
  expect(changes.at(-1)).toEqual([{ dir: GLOBEX, name: 'globex' }]);
});

it('kills outright a session that outlasts the hangup, so none runs on beside the one a reopen starts', async () => {
  const acme = fakeProject({ tasks: ['t1', 't2'] });
  const { registry, killed, host } = setup({ made: { [ACME]: () => acme }, exitMs: 10_000, closeTimeoutMs: 50 });
  await registry.open(ACME);
  host.delete('t2');
  vi.mocked(acme.release).mockImplementation(async () => expect([...host]).toEqual([]));

  await registry.close(ACME);

  expect(killed).toEqual(['t1', 't2', 't1 SIGKILL']);
  expect(acme.release).toHaveBeenCalledOnce();
});

it('lets go of a closed project whose sessions outlast even being killed', async () => {
  const acme = fakeProject({ tasks: ['t1'] });
  const { registry } = setup({ made: { [ACME]: () => acme }, exitMs: 10_000, killMs: 10_000, closeTimeoutMs: 50 });
  await registry.open(ACME);
  await registry.close(ACME);
  expect(acme.release).toHaveBeenCalledOnce();
});

it('opens and closes a project when it cannot write projects.json, and says why', async () => {
  const blocked = join(dataDir, 'not-a-folder');
  writeFileSync(blocked, '');
  const acme = fakeProject({ tasks: ['t1'] });
  const { registry, killed, changes } = setup({ made: { [ACME]: () => acme }, dir: blocked });
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});

  await registry.open(ACME);
  expect(acme.start).toHaveBeenCalledOnce();
  await registry.close(ACME);

  expect(killed).toEqual(['t1']);
  expect(acme.release).toHaveBeenCalledOnce();
  expect(changes).toEqual([[{ dir: ACME, name: 'acme' }], []]);
  expect(error).toHaveBeenCalledWith('[projects] could not remember the open projects', expect.any(Error));
  error.mockRestore();
});

it('opens a project that is closing only once its sessions have ended', async () => {
  const first = fakeProject({ tasks: ['t1'] });
  const second = fakeProject({ tasks: ['t9'] });
  const projects = [first, second];
  const { registry, host } = setup({ made: { [ACME]: () => projects.shift()! }, exitMs: 30 });
  await registry.open(ACME);

  const closing = registry.close(ACME);
  vi.mocked(second.start).mockImplementation(() => expect(host.has('t1')).toBe(false));
  await registry.open(ACME);
  await closing;

  expect(registry.get(ACME)).toBe(second);
  expect(second.start).toHaveBeenCalledOnce();
});

it('opens a project again when its close failed to let go of the rest; the close says why', async () => {
  const first = fakeProject({ tasks: ['t1'] });
  const second = fakeProject();
  const projects = [first, second];
  vi.mocked(first.release).mockRejectedValue(new Error('the server would not close'));
  const { registry } = setup({ made: { [ACME]: () => projects.shift()! }, exitMs: 30 });
  await registry.open(ACME);

  const closed = expect(registry.close(ACME)).rejects.toThrow('the server would not close');
  await registry.open(ACME);
  await closed;

  expect(registry.get(ACME)).toBe(second);
  expect(second.start).toHaveBeenCalledOnce();
});

it('starts no project still opening as Mainframe quits, so its tasks stay as recorded', async () => {
  const acme = fakeProject({ tasks: ['t1'] });
  const { registry, changes } = setup({ made: { [ACME]: () => acme } });

  const opening = registry.open(ACME);
  registry.beginQuit();
  await opening;

  expect(acme.start).not.toHaveBeenCalled();
  expect(acme.release).toHaveBeenCalledOnce();
  expect(registry.list()).toEqual([]);
  expect(changes).toEqual([]);
});

it('closing a project that is not open does nothing', async () => {
  const { registry, changes } = setup();
  await registry.close(ACME);
  expect(changes).toEqual([]);
});

it("ends every project's sessions as Mainframe quits", async () => {
  const acme = fakeProject({ tasks: ['t1'] });
  const globex = fakeProject({ manager: ['m2'] });
  const { registry } = setup({ made: { [ACME]: () => acme, [GLOBEX]: () => globex } });
  await registry.open(ACME);
  await registry.open(GLOBEX);

  registry.beginQuit();

  for (const p of [acme, globex]) {
    expect(p.service.beginQuit).toHaveBeenCalledOnce();
    expect(p.manager.beginQuit).toHaveBeenCalledOnce();
  }
});

it("records the other projects' sessions when one project's record fails", async () => {
  const acme = fakeProject({ tasks: ['t1'] });
  const globex = fakeProject({ tasks: ['t2'] });
  vi.mocked(acme.service.beginQuit).mockImplementation(() => {
    throw new Error('disk full');
  });
  const { registry } = setup({ made: { [ACME]: () => acme, [GLOBEX]: () => globex } });
  await registry.open(ACME);
  await registry.open(GLOBEX);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});

  registry.beginQuit();

  expect(acme.manager.beginQuit).toHaveBeenCalledOnce();
  expect(globex.service.beginQuit).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledWith(`[tasks] could not record where the sessions of ${ACME} were`, expect.any(Error));
  error.mockRestore();
});
