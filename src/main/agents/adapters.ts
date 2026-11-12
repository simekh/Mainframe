import type { AgentName } from '../../shared/types';
import type { AgentAdapter } from './agent';
import { claudeAgent } from './claude';
import { opencodeAgent } from './opencode';

export const ADAPTERS: Record<AgentName, AgentAdapter> = { claude: claudeAgent, opencode: opencodeAgent };
