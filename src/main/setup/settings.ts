import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AGENT_ORDER, type AgentName } from '../../shared/types';
import type { AgentSetting } from '../agents/agent';
import { writeJsonAtomic } from '../tasks/taskStore';

/**
 * `settings.json`, in the data folder: what Mainframe remembers for every open project alike. Nothing
 * here belongs to one project.
 */
const FILE = 'settings.json';
const VERSION = 2;

export interface AppSettings {
  /** Each agent's tick, path and options. Claude Code's path is not saved while MAINFRAME_CLAUDE_BIN names it. */
  agents?: Partial<Record<AgentName, AgentSetting>>;
  /** The agent a new task and the manager start on. */
  defaultAgent?: AgentName;
  /** The welcome has been shown and a first project chosen. Kept apart from the agents, so it holds when MAINFRAME_CLAUDE_BIN is set. */
  welcomeSeen?: boolean;
}

const agentName = z.enum(AGENT_ORDER);
const agentSetting = z.strictObject({
  enabled: z.boolean().optional(),
  bin: z.string().optional(),
  managerAgent: z.string().optional(),
  syncModel: z.string().optional(),
});
const settingsV2 = z.strictObject({
  version: z.literal(2),
  agents: z.partialRecord(agentName, agentSetting).optional(),
  defaultAgent: agentName.optional(),
  welcomeSeen: z.boolean().optional(),
});
const settingsV1 = z.strictObject({ version: z.literal(1), claudeBin: z.string().optional(), welcomeSeen: z.boolean().optional() });

/**
 * The settings, or none when the file is missing or cannot be used. Throws for one a newer Mainframe
 * wrote: that is neither read nor touched, so that build still has it whole. A version 1 file reads as
 * Claude Code ticked and the default, with its path kept; the file stays as it is until the next save.
 */
export function readSettings(dataDir: string, warn: (msg: string) => void): AppSettings {
  const file = join(dataDir, FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Could not read ${file} (${String(err)}); treating it as missing`);
    return {};
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  if (typeof record.version === 'number' && record.version > VERSION) {
    throw new Error('settings.json was written by a newer Mainframe; update this one, or move the file away');
  }
  const v2 = settingsV2.safeParse(record);
  if (v2.success) {
    const { version: _version, ...settings } = v2.data;
    return settings;
  }
  const v1 = settingsV1.safeParse(record);
  if (v1.success) {
    const { claudeBin, welcomeSeen } = v1.data;
    return {
      agents: { claude: { enabled: true, ...(claudeBin !== undefined && { bin: claudeBin }) } },
      defaultAgent: 'claude',
      ...(welcomeSeen !== undefined && { welcomeSeen }),
    };
  }
  warn(`Could not use ${file} (it does not hold version ${VERSION} settings); treating it as missing`);
  return {};
}

export function writeSettings(dataDir: string, settings: AppSettings): void {
  writeJsonAtomic(join(dataDir, FILE), { version: VERSION, ...settings });
}
