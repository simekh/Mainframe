import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexConfigFile, codexMissesClaudeMd } from './codexInstructions';

const environment = { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] };
const heading = { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /p\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>' }] };
const loaded = JSON.stringify([heading, environment]);
const notLoaded = JSON.stringify([environment]);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'codex-instr-'));
  dirs.push(dir);
  for (const file of files) writeFileSync(join(dir, file), 'rules');
  return dir;
}

const check = (projectDir: string, run: () => Promise<string>) => codexMissesClaudeMd({ bin: '/b/codex', projectDir, env: {}, run });

describe('codexMissesClaudeMd', () => {
  it('a CLAUDE.md that Codex would not load is missed', async () => {
    await expect(check(project('CLAUDE.md'), async () => notLoaded)).resolves.toBe(true);
  });

  it('a CLAUDE.md that Codex loads is not missed', async () => {
    await expect(check(project('CLAUDE.md'), async () => loaded)).resolves.toBe(false);
  });

  it('with an AGENTS.md, or no CLAUDE.md, codex is not run at all', async () => {
    const run = vi.fn(async () => notLoaded);
    await expect(check(project('CLAUDE.md', 'AGENTS.md'), run)).resolves.toBe(false);
    await expect(check(project('AGENTS.md'), run)).resolves.toBe(false);
    await expect(check(project(), run)).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('the AGENTS.md heading anywhere in the prompt input means it is not missed', async () => {
    await expect(check(project('CLAUDE.md'), async () => JSON.stringify([environment, heading]))).resolves.toBe(false);
  });

  it('codex failing, printing non-JSON, an object, or a list without its environment context counts as not missed', async () => {
    const dir = project('CLAUDE.md');
    await expect(check(dir, async () => Promise.reject(new Error('exit 1')))).resolves.toBe(false);
    await expect(check(dir, async () => 'oops')).resolves.toBe(false);
    await expect(check(dir, async () => '{}')).resolves.toBe(false);
    await expect(check(dir, async () => '[]')).resolves.toBe(false);
    await expect(check(dir, async () => '[null, 3, {"type":"message","role":"user","content":[null]}]')).resolves.toBe(false);
    await expect(check(dir, async () => JSON.stringify([{ ...environment, role: 'developer' }]))).resolves.toBe(false);
  });

  it('codex runs as `<bin> debug prompt-input` in the project folder', async () => {
    const dir = project('CLAUDE.md');
    const run = vi.fn(async () => loaded);
    await codexMissesClaudeMd({ bin: '/b/codex', projectDir: dir, env: { A: '1' }, run });
    expect(run).toHaveBeenCalledWith(['/b/codex', 'debug', 'prompt-input'], { cwd: dir, env: { A: '1' } });
  });
});

describe('codexConfigFile', () => {
  it('the config file is $CODEX_HOME/config.toml, else ~/.codex or %USERPROFILE%\\.codex', () => {
    expect(codexConfigFile({ CODEX_HOME: '/c' }, 'darwin')).toBe('/c/config.toml');
    expect(codexConfigFile({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.codex/config.toml');
    expect(codexConfigFile({ USERPROFILE: 'C:\\Users\\u' }, 'win32')).toBe('C:\\Users\\u\\.codex\\config.toml');
  });
});
