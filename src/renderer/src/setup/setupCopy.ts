import {
  AGENT_NAMES,
  AGENT_ORDER,
  MIN_CLAUDE_VERSION,
  MIN_OPENCODE_VERSION,
  type AgentChoice,
  type AgentName,
  type ProgramCheck,
  type SetupView,
} from '../../../shared/types';
import { works } from '../settings/defaultChoice';

/** What the setup screen's buttons do; main and the screen both decide nothing else about them. */
export type SetupButton = `find-${AgentName}` | `install-${AgentName}` | 'install-git' | 'look-again' | 'choose-project';

/** The screen's words for what one failing check, or the last question, needs from the person. */
export interface Explanation {
  check: 'git' | 'agents' | 'project';
  /** One paragraph each; a `\n` inside one is a line break. */
  lines: string[];
  /** The first is the primary one. Look again is only in the last block: it looks at every failing check. */
  buttons: SetupButton[];
  /** The tone of each line by its place, where the block sets one. */
  tones?: Array<'strong' | 'hint'>;
}

/** A line of the screen's opening. */
export interface IntroLine {
  text: string;
  tone?: 'logo' | 'strong';
  /** Dimmed, after the text on the same line. */
  aside?: string;
}

const LOGO = [' ▄▀▄▀▄ ▄▀▄ ▀ █▄ █ █▀▀ █▀▄ ▄▀▄ ▄▀▄▀▄ █▀▀', ' █   █ █▀█ █ █ ▀█ █▀  █▀▄ █▀█ █   █ ██▄'].join('\n');

/** The welcome at a true first start; at any later start only that something moved. */
export function intro(view: SetupView): IntroLine[] {
  if (view.intro === 'moved') {
    return [{ text: 'Something moved since last time, so I had another look around.', tone: 'strong' }];
  }
  return [
    { text: LOGO, tone: 'logo' },
    { text: "Hi, I'm Mainframe.", tone: 'strong' },
    {
      text: "I keep a whole crew of coding agent sessions busy at once, each on its own task in its own git worktree, and I only tap you on the shoulder when one of them needs you.",
    },
    {
      text: "Before we get going, I'm going to have a quick look around this computer.",
      aside: "(Nothing leaves it. I'm just checking what's installed.)",
    },
  ];
}

/**
 * What a check says after its name: what was found, or what is wrong. `looking` is while a new look runs. `quiet`
 * while another agent works: a failing agent is then no problem, so its line says only what it is, with no ✗.
 */
export function checkLine(name: 'git' | AgentName, check: ProgramCheck | 'looking', quiet: boolean): string {
  if (check === 'looking') return 'looking…';
  if (quiet && check.state !== 'found') {
    return check.state === 'too-old' ? `v${check.version}, too old` : check.state === 'broken' ? "doesn't run" : 'not found';
  }
  switch (check.state) {
    case 'found':
      return `found  ${name === 'git' ? `git ${check.version}` : `${check.path} · v${check.version}`}  ✓`;
    case 'missing':
      // A path is there only for a file picked by hand, or named by the agent's env var.
      return check.path === undefined ? 'not found  ✗' : `${check.path} isn't a program I can run  ✗`;
    case 'too-old':
      return `${check.path} · v${check.version}, too old  ✗`;
    case 'broken':
      return `${check.path} doesn't run  ✗`;
  }
}

export function buttonLabel(button: SetupButton, platform: NodeJS.Platform): string {
  switch (button) {
    case 'find-claude':
      return platform === 'win32' ? 'Find claude.exe…' : 'Find claude…';
    case 'find-opencode':
      return platform === 'win32' ? 'Find opencode.exe…' : 'Find opencode…';
    // The agent is named: with no agent working, both links sit side by side.
    case 'install-claude':
      return 'How to install Claude Code ↗';
    case 'install-opencode':
      return 'How to install OpenCode ↗';
    case 'install-git':
      return 'How to install git ↗';
    case 'look-again':
      return 'Look again';
    case 'choose-project':
      return 'Choose a folder…';
  }
}

const NEW_TERMINAL =
  'Just installed it? A program installed after Mainframe started is often invisible to it: close Mainframe, open a new terminal and run npm start again.';

function gitBlock({ git }: SetupView, platform: NodeJS.Platform): Explanation | null {
  if (git.state === 'found') return null;
  const buttons: SetupButton[] = ['install-git', 'look-again'];
  if (git.state === 'missing') {
    return {
      check: 'git',
      lines: [
        "I couldn't find git on your PATH. Every task runs in its own git worktree, so I need it. Install git, then I'll look again.",
      ],
      buttons,
    };
  }
  const lines = [`I found git at ${git.path}, but it didn't run.`];
  if (platform === 'darwin') {
    lines.push(
      "On a Mac that usually means Apple's command line tools aren't installed yet: run xcode-select --install in a terminal, then I'll look again.",
    );
  }
  return { check: 'git', lines, buttons };
}

/** What each agent's lines name when it can't be used. */
const AGENT_COPY: Record<AgentName, { envVar: string; min: string; nowhere(platform: NodeJS.Platform): string; update: string }> = {
  claude: {
    envVar: 'MAINFRAME_CLAUDE_BIN',
    min: MIN_CLAUDE_VERSION,
    nowhere: (platform) =>
      platform === 'win32'
        ? "Hmm. I looked on your PATH, in %USERPROFILE%\\.local\\bin and in npm's global folder, and Claude Code wasn't in any of them."
        : "Hmm. I looked on your PATH and in ~/.local/bin, and Claude Code wasn't in either.",
    update: 'Run claude update in a terminal',
  },
  opencode: {
    envVar: 'MAINFRAME_OPENCODE_BIN',
    min: MIN_OPENCODE_VERSION,
    nowhere: (platform) =>
      platform === 'win32'
        ? "I looked on your PATH and in %USERPROFILE%\\.opencode\\bin, and OpenCode wasn't in either."
        : "I looked on your PATH and in ~/.opencode/bin, and OpenCode wasn't in either.",
    update: 'Run opencode upgrade in a terminal',
  },
};

const NO_AGENT = "I need a coding agent to run your tasks, Claude Code or OpenCode, and I couldn't use either.";
const POINT_ME = "If it's installed somewhere else, point me to it.\nIf it isn't, install it and I'll look again.";

/** Why the agent can't be used, in its own lines. */
function agentReason(name: AgentName, check: Exclude<ProgramCheck, { state: 'found' }>, fromEnv: boolean, platform: NodeJS.Platform): string[] {
  const copy = AGENT_COPY[name];
  // What its env var names is the only place looked, so only a change there, or none, helps.
  if (fromEnv) {
    const reason =
      check.state === 'too-old'
        ? `It's v${check.version}, and I need v${copy.min} or newer.`
        : check.state === 'broken'
          ? "It's there, but it didn't tell me its version."
          : "There's nothing there I can run.";
    return [`${copy.envVar} is set to ${check.path}, so that's the only place I look.`, reason, 'Change it or unset it, then start Mainframe again.'];
  }
  switch (check.state) {
    case 'missing':
      return [check.path !== undefined ? `${check.path} isn't a program I can run.` : copy.nowhere(platform)];
    case 'too-old':
      return [`This ${AGENT_NAMES[name]} is v${check.version}, and I need v${copy.min} or newer. ${copy.update}, then I'll look again.`];
    case 'broken': {
      const lines = [`${check.path} is there, but it didn't tell me its version.`];
      if (name === 'claude' && platform === 'win32') {
        lines.push(
          "If Claude Code came from npm, its launcher can't run on its own; Anthropic's native installer gives me a claude.exe I can use.",
        );
      }
      return lines;
    }
  }
}

/** Missing where a new terminal may find it: not one its env var names. */
const findable = (view: SetupView, name: AgentName) => view.agents[name].check.state === 'missing' && !view.agents[name].fromEnv;

/** An agent Mainframe can run on: ticked and found. A found agent that is unticked doesn't count. */
export const someAgentWorks = (view: SetupView) =>
  AGENT_ORDER.some((name) => view.agents[name].ticked && works(view, name));

/**
 * A failing agent is a problem only while no agent works: then one block says why for each that isn't found, with
 * its buttons. A found agent that is unticked has nothing to fix.
 */
function agentsBlock(view: SetupView, platform: NodeJS.Platform): Explanation | null {
  if (someAgentWorks(view)) return null;
  const failing = AGENT_ORDER.filter((name) => view.agents[name].check.state !== 'found');
  const off = AGENT_ORDER.find((name) => works(view, name));
  const lines = [
    off === undefined ? NO_AGENT : `I couldn't use the coding agent that's switched on. ${AGENT_NAMES[off]} is here, but it's switched off.`,
    ...AGENT_ORDER.flatMap((name) => {
      const { check, fromEnv } = view.agents[name];
      return check.state === 'found' ? [] : agentReason(name, check, fromEnv, platform);
    }),
  ];
  if (failing.some((name) => findable(view, name))) lines.push(POINT_ME);
  const buttons = failing.flatMap((name): SetupButton[] => [
    ...(view.agents[name].fromEnv ? [] : [`find-${name}` as const]),
    `install-${name}`,
  ]);
  return { check: 'agents', lines, buttons: [...buttons, 'look-again'] };
}

/**
 * One block per failing check, git's first. With everything found, the project question while one is
 * asked. The new-terminal hint ends the last block's lines.
 */
export function explanations(view: SetupView, platform: NodeJS.Platform): Explanation[] {
  const agents = agentsBlock(view, platform);
  const failing = [gitBlock(view, platform), agents].filter((block) => block !== null);
  if (failing.length === 0) {
    return view.ask
      ? [
          {
            check: 'project',
            lines: ['All here. Last thing: which project should we start with?', "Any folder that's a git repository. You can open more later."],
            buttons: ['choose-project'],
            tones: ['strong', 'hint'],
          },
        ]
      : [];
  }
  const last = failing[failing.length - 1];
  const stillMissing = view.git.state === 'missing' || (agents !== null && AGENT_ORDER.some((name) => findable(view, name)));
  return failing.map((block) =>
    block === last
      ? { ...block, lines: view.lookedAgain && stillMissing ? [...block.lines, NEW_TERMINAL] : block.lines }
      : { ...block, buttons: block.buttons.filter((button) => button !== 'look-again') },
  );
}

/** One agent in the "Which agents should I use?" step. One that doesn't work can't be ticked, and offers its buttons. */
export interface AgentRow {
  name: AgentName;
  works: boolean;
  ticked: boolean;
  version?: string;
  buttons: SetupButton[];
}

/** The agents step at a first start, for the choice made so far. */
export function agentStep(view: SetupView, choice: AgentChoice): { rows: AgentRow[]; showDefault: boolean; hint: string } {
  const rows = AGENT_ORDER.map((name): AgentRow => {
    const { check, fromEnv } = view.agents[name];
    if (check.state === 'found') return { name, works: true, ticked: choice.ticked.includes(name), version: check.version, buttons: [] };
    return { name, works: false, ticked: false, buttons: [`install-${name}`, ...(fromEnv ? [] : [`find-${name}` as const])] };
  });
  const two = choice.ticked.length > 1;
  return {
    rows,
    showDefault: two,
    hint: two
      ? 'You can still pick the other one for a single task in the New task box. All of this can be changed in Settings later.'
      : `${AGENT_NAMES[choice.ticked[0]]} runs everything: the manager, the Todo sync and your tasks. Settings can change this later.`,
  };
}
