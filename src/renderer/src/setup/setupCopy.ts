import { MIN_CLAUDE_VERSION, type ProgramCheck, type SetupView } from '../../../shared/types';

/** What the setup screen's buttons do; main and the screen both decide nothing else about them. */
export type SetupButton = 'find-claude' | 'install-claude' | 'install-git' | 'look-again' | 'choose-project';

/** The screen's words for what one failing check, or the last question, needs from the person. */
export interface Explanation {
  check: 'git' | 'claude' | 'project';
  /** One paragraph each; a `\n` inside one is a line break. */
  lines: string[];
  /** The first is the primary one. Look again is only in the last block: it looks at every failing check. */
  buttons: SetupButton[];
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
      text: "I keep a whole crew of Claude Code sessions busy at once, each on its own task in its own git worktree, and I only tap you on the shoulder when one of them needs you.",
    },
    {
      text: "Before we get going, I'm going to have a quick look around this computer.",
      aside: "(Nothing leaves it. I'm just checking what's installed.)",
    },
  ];
}

/** What a check says after its name: what was found, or what is wrong. `looking` is while a new look runs. */
export function checkLine(name: 'git' | 'claude', check: ProgramCheck | 'looking'): string {
  if (check === 'looking') return 'looking…';
  switch (check.state) {
    case 'found':
      return `found  ${name === 'git' ? `git ${check.version}` : `${check.path} · v${check.version}`}  ✓`;
    case 'missing':
      return 'not found  ✗';
    case 'too-old':
      return `${check.path} · v${check.version}, too old  ✗`;
    case 'broken':
      return `${check.path} doesn't run  ✗`;
  }
}

export function buttonLabel(button: SetupButton, platform: SetupView['platform']): string {
  switch (button) {
    case 'find-claude':
      return platform === 'win32' ? 'Find claude.exe…' : 'Find claude…';
    case 'install-claude':
      return 'How to install ↗';
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

function gitBlock({ git, platform }: SetupView): Explanation | null {
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

function claudeBlock(view: SetupView): Explanation | null {
  const { claude, platform } = view;
  if (claude.state === 'found') return null;
  // What MAINFRAME_CLAUDE_BIN names is the only claude looked at, so only a change there, or none, helps.
  if (view.claudeFromEnv) {
    const reason =
      claude.state === 'missing'
        ? "There's nothing there I can run."
        : claude.state === 'too-old'
          ? `It's v${claude.version}, and I need v${MIN_CLAUDE_VERSION} or newer.`
          : "It's there, but it didn't tell me its version.";
    return {
      check: 'claude',
      lines: [
        `MAINFRAME_CLAUDE_BIN is set to ${claude.path}, so that's the only place I look.`,
        reason,
        'Change it or unset it, then start Mainframe again.',
      ],
      buttons: ['look-again'],
    };
  }
  switch (claude.state) {
    case 'missing':
      return {
        check: 'claude',
        lines: [
          platform === 'win32'
            ? "Hmm. I looked on your PATH, in %USERPROFILE%\\.local\\bin and in npm's global folder, and Claude Code wasn't in any of them."
            : "Hmm. I looked on your PATH and in ~/.local/bin, and Claude Code wasn't in either.",
          "If it's installed somewhere else, point me to it.\nIf it isn't, install it and I'll look again.",
        ],
        buttons: ['find-claude', 'install-claude', 'look-again'],
      };
    case 'too-old':
      return {
        check: 'claude',
        lines: [
          `This Claude Code is v${claude.version}, and I need v${MIN_CLAUDE_VERSION} or newer. Run claude update in a terminal, then I'll look again.`,
        ],
        buttons: ['look-again', 'find-claude'],
      };
    case 'broken': {
      const lines = [`${claude.path} is there, but it didn't tell me its version.`];
      if (platform === 'win32') {
        lines.push(
          "If Claude Code came from npm, its launcher can't run on its own; Anthropic's native installer gives me a claude.exe I can use.",
        );
      }
      return { check: 'claude', lines, buttons: ['find-claude', 'install-claude', 'look-again'] };
    }
  }
}

/**
 * One block per failing check, git's first. With everything found, the project question while one is
 * asked. The new-terminal hint ends the last block's lines.
 */
export function explanations(view: SetupView): Explanation[] {
  const failing = [gitBlock(view), claudeBlock(view)].filter((block) => block !== null);
  if (failing.length === 0) {
    return view.askProject
      ? [
          {
            check: 'project',
            lines: ['All here. Last thing: which project should we start with?', "Any folder that's a git repository. You can open more later."],
            buttons: ['choose-project'],
          },
        ]
      : [];
  }
  const last = failing[failing.length - 1];
  const stillMissing = view.git.state === 'missing' || (view.claude.state === 'missing' && !view.claudeFromEnv);
  return failing.map((block) =>
    block === last
      ? { ...block, lines: view.lookedAgain && stillMissing ? [...block.lines, NEW_TERMINAL] : block.lines }
      : { ...block, buttons: block.buttons.filter((button) => button !== 'look-again') },
  );
}
