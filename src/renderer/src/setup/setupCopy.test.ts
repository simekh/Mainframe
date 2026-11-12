import { describe, expect, it } from 'vitest';
import { MIN_CLAUDE_VERSION, MIN_OPENCODE_VERSION, type AgentChoice, type ProgramCheck, type SetupView } from '../../../shared/types';
import { agentStep, buttonLabel, checkLine, explanations, intro, someAgentWorks, type SetupButton } from './setupCopy';

const found = (path: string, version: string): ProgramCheck => ({ state: 'found', path, version });
const missing: ProgramCheck = { state: 'missing' };

interface Over extends Partial<Omit<SetupView, 'agents'>> {
  claude?: ProgramCheck;
  claudeFromEnv?: boolean;
  opencode?: ProgramCheck;
  opencodeFromEnv?: boolean;
  /** With nothing saved an agent is ticked when it is found; this says otherwise. */
  ticked?: Partial<Record<'claude' | 'opencode', boolean>>;
}

/** A view where git and Claude Code are found and OpenCode is not; each test changes what it is about. */
const view = (over: Over = {}): SetupView => {
  const {
    claude = found('/home/me/.local/bin/claude', '2.1.319'),
    claudeFromEnv = false,
    opencode = missing,
    opencodeFromEnv = false,
    ticked = {},
    ...rest
  } = over;
  return {
    intro: 'welcome',
    git: found('/usr/bin/git', '2.56.0'),
    agents: {
      claude: { check: claude, fromEnv: claudeFromEnv, ticked: ticked.claude ?? claude.state === 'found' },
      opencode: { check: opencode, fromEnv: opencodeFromEnv, ticked: ticked.opencode ?? opencode.state === 'found' },
    },
    lookedAgain: false,
    ask: null,
    ...rest,
  };
};

const blocks = (over: Over, platform: NodeJS.Platform = 'linux') => explanations(view(over), platform);
const buttonsOf = (over: Over) => blocks(over).map((b) => b.buttons);

const NEW_TERMINAL =
  'Just installed it? A program installed after Mainframe started is often invisible to it: close Mainframe, open a new terminal and run npm start again.';
const NONE = "I need a coding agent to run your tasks, Claude Code or OpenCode, and I couldn't use either.";
const ASK = "If it's installed somewhere else, point me to it.\nIf it isn't, install it and I'll look again.";
const CLAUDE_NOWHERE = "Hmm. I looked on your PATH and in ~/.local/bin, and Claude Code wasn't in either.";
const OPENCODE_NOWHERE = "I looked on your PATH and in ~/.opencode/bin, and OpenCode wasn't in either.";
const ALL_BUTTONS: SetupButton[] = ['find-claude', 'install-claude', 'find-opencode', 'install-opencode', 'look-again'];

describe('checkLine', () => {
  it('says what a found git is', () => {
    expect(checkLine('git', found('/usr/bin/git', '2.56.0'), false)).toBe('found  git 2.56.0  ✓');
  });

  it('says where a found agent is and which version, in full', () => {
    expect(checkLine('claude', found('C:\\Users\\me\\.local\\bin\\claude.exe', '2.1.319'), false)).toBe(
      'found  C:\\Users\\me\\.local\\bin\\claude.exe · v2.1.319  ✓',
    );
    expect(checkLine('opencode', found('/home/me/.opencode/bin/opencode', '2.2.7'), true)).toBe(
      'found  /home/me/.opencode/bin/opencode · v2.2.7  ✓',
    );
  });

  it('says it is looking while a new look runs', () => {
    expect(checkLine('git', 'looking', false)).toBe('looking…');
    expect(checkLine('claude', 'looking', true)).toBe('looking…');
  });

  it('says a program that is nowhere is not found', () => {
    expect(checkLine('git', missing, false)).toBe('not found  ✗');
    expect(checkLine('claude', missing, false)).toBe('not found  ✗');
  });

  it('says a file that was picked and is no program, with its path', () => {
    expect(checkLine('claude', { state: 'missing', path: '/opt/claude' }, false)).toBe("/opt/claude isn't a program I can run  ✗");
  });

  it('says an agent that is too old, with its path and version', () => {
    expect(checkLine('claude', { state: 'too-old', path: '/opt/claude', version: '2.0.1' }, false)).toBe('/opt/claude · v2.0.1, too old  ✗');
  });

  it("says a program that doesn't run, with its path", () => {
    expect(checkLine('git', { state: 'broken', path: '/usr/bin/git' }, false)).toBe("/usr/bin/git doesn't run  ✗");
    expect(checkLine('claude', { state: 'broken', path: '/opt/claude' }, false)).toBe("/opt/claude doesn't run  ✗");
  });

  it('says a failing agent quietly while another works: no path and no ✗', () => {
    expect(checkLine('claude', missing, true)).toBe('not found');
    expect(checkLine('claude', { state: 'missing', path: '/opt/claude' }, true)).toBe('not found');
    expect(checkLine('opencode', { state: 'too-old', path: '/opt/opencode', version: '1.18.35' }, true)).toBe('v1.18.35, too old');
    expect(checkLine('opencode', { state: 'broken', path: '/opt/opencode' }, true)).toBe("doesn't run");
  });
});

describe('intro', () => {
  it("is the welcome at a first start: the logo, then Mainframe's three paragraphs", () => {
    const lines = intro(view({ intro: 'welcome' }));
    expect(lines.map((l) => l.tone)).toEqual(['logo', 'strong', undefined, undefined]);
    expect(lines[0].text).toBe(
      [' ▄▀▄▀▄ ▄▀▄ ▀ █▄ █ █▀▀ █▀▄ ▄▀▄ ▄▀▄▀▄ █▀▀', ' █   █ █▀█ █ █ ▀█ █▀  █▀▄ █▀█ █   █ ██▄'].join('\n'),
    );
    expect(lines.slice(1).map((l) => l.text)).toEqual([
      "Hi, I'm Mainframe.",
      "I keep a whole crew of coding agent sessions busy at once, each on its own task in its own git worktree, and I only tap you on the shoulder when one of them needs you.",
      "Before we get going, I'm going to have a quick look around this computer.",
    ]);
    expect(lines[3].aside).toBe("(Nothing leaves it. I'm just checking what's installed.)");
  });

  it('names no agent in the welcome', () => {
    const text = intro(view({ intro: 'welcome' })).map((l) => l.text).join('\n');
    expect(text).toContain('coding agent sessions');
    expect(text).not.toContain('Claude Code');
  });

  it('is one line at any later start', () => {
    expect(intro(view({ intro: 'moved' }))).toEqual([
      { text: 'Something moved since last time, so I had another look around.', tone: 'strong' },
    ]);
  });
});

describe('buttonLabel', () => {
  it('names the file Mainframe looks for on Windows', () => {
    expect(buttonLabel('find-claude', 'win32')).toBe('Find claude.exe…');
    expect(buttonLabel('find-claude', 'darwin')).toBe('Find claude…');
    expect(buttonLabel('find-claude', 'linux')).toBe('Find claude…');
    expect(buttonLabel('find-opencode', 'win32')).toBe('Find opencode.exe…');
    expect(buttonLabel('find-opencode', 'darwin')).toBe('Find opencode…');
  });

  it('labels the others the same everywhere', () => {
    const labels: Record<Exclude<SetupButton, 'find-claude' | 'find-opencode'>, string> = {
      'install-claude': 'How to install Claude Code ↗',
      'install-opencode': 'How to install OpenCode ↗',
      'install-git': 'How to install git ↗',
      'look-again': 'Look again',
      'choose-project': 'Choose a folder…',
    };
    for (const [button, label] of Object.entries(labels)) {
      expect(buttonLabel(button as SetupButton, 'win32')).toBe(label);
      expect(buttonLabel(button as SetupButton, 'darwin')).toBe(label);
    }
  });
});

describe('explanations', () => {
  it('has no block while everything is found and no project is asked for', () => {
    expect(blocks({})).toEqual([]);
  });

  it('asks which project to start with, once everything is found', () => {
    expect(blocks({ ask: { ticked: ['claude'], defaultAgent: 'claude' } })).toEqual([
      {
        check: 'project',
        lines: ['All here. Last thing: which project should we start with?', "Any folder that's a git repository. You can open more later."],
        buttons: ['choose-project'],
        tones: ['strong', 'hint'],
      },
    ]);
  });

  it('asks about the project only when nothing is missing', () => {
    expect(blocks({ ask: { ticked: ['claude'], defaultAgent: 'claude' }, git: missing }).map((b) => b.check)).toEqual(['git']);
  });

  it('has no agents block while one agent works', () => {
    expect(blocks({ claude: missing, opencode: found('/o', '2.2.7') })).toEqual([]);
    expect(blocks({ claude: { state: 'too-old', path: '/c', version: '2.0.1' } , opencode: found('/o', '2.2.7') })).toEqual([]);
  });

  describe('git', () => {
    it('is missing: asks to install it', () => {
      expect(blocks({ git: missing })).toEqual([
        {
          check: 'git',
          lines: [
            "I couldn't find git on your PATH. Every task runs in its own git worktree, so I need it. Install git, then I'll look again.",
          ],
          buttons: ['install-git', 'look-again'],
        },
      ]);
    });

    it("didn't run: on a Mac, points at the command line tools", () => {
      expect(blocks({ git: { state: 'broken', path: '/usr/bin/git' } }, 'darwin')).toEqual([
        {
          check: 'git',
          lines: [
            "I found git at /usr/bin/git, but it didn't run.",
            "On a Mac that usually means Apple's command line tools aren't installed yet: run xcode-select --install in a terminal, then I'll look again.",
          ],
          buttons: ['install-git', 'look-again'],
        },
      ]);
    });

    it("didn't run: elsewhere, says only that", () => {
      for (const platform of ['win32', 'linux'] as const) {
        expect(blocks({ git: { state: 'broken', path: 'C:\\Git\\git.exe' } }, platform)[0].lines).toEqual([
          "I found git at C:\\Git\\git.exe, but it didn't run.",
        ]);
      }
    });
  });

  describe('no agent works', () => {
    it('gives one agents block: why, each agent in turn, and the five buttons', () => {
      expect(blocks({ claude: missing })).toEqual([
        { check: 'agents', lines: [NONE, CLAUDE_NOWHERE, OPENCODE_NOWHERE, ASK], buttons: ALL_BUTTONS },
      ]);
    });

    it('on Windows: names the places looked in there', () => {
      expect(blocks({ claude: missing }, 'win32')[0].lines).toEqual([
        NONE,
        "Hmm. I looked on your PATH, in %USERPROFILE%\\.local\\bin and in npm's global folder, and Claude Code wasn't in any of them.",
        "I looked on your PATH and in %USERPROFILE%\\.opencode\\bin, and OpenCode wasn't in either.",
        ASK,
      ]);
    });

    it("after a file was picked that can't be run: says which file, in place of the places looked in", () => {
      expect(blocks({ claude: { state: 'missing', path: '/opt/claude' }, opencode: { state: 'missing', path: '/opt/opencode' } })[0].lines).toEqual([
        NONE,
        "/opt/claude isn't a program I can run.",
        "/opt/opencode isn't a program I can run.",
        ASK,
      ]);
    });

    it('too old: asks to update each, and asks nothing more when none is missing', () => {
      const result = blocks({
        claude: { state: 'too-old', path: '/opt/claude', version: '2.0.1' },
        opencode: { state: 'too-old', path: '/opt/opencode', version: '1.18.35' },
      });
      expect(result).toEqual([
        {
          check: 'agents',
          lines: [
            NONE,
            `This Claude Code is v2.0.1, and I need v${MIN_CLAUDE_VERSION} or newer. Run claude update in a terminal, then I'll look again.`,
            `This OpenCode is v1.18.35, and I need v${MIN_OPENCODE_VERSION} or newer. Run opencode upgrade in a terminal, then I'll look again.`,
          ],
          buttons: ALL_BUTTONS,
        },
      ]);
    });

    it("broken: says it didn't tell its version, and on Windows why an npm launcher doesn't work", () => {
      const broken = { claude: { state: 'broken', path: '/opt/claude' }, opencode: { state: 'broken', path: '/opt/opencode' } } as const;
      expect(blocks(broken, 'darwin')[0].lines).toEqual([
        NONE,
        "/opt/claude is there, but it didn't tell me its version.",
        "/opt/opencode is there, but it didn't tell me its version.",
      ]);
      expect(blocks({ ...broken, claude: { state: 'broken', path: 'C:\\npm\\claude.cmd' } }, 'win32')[0].lines).toEqual([
        NONE,
        "C:\\npm\\claude.cmd is there, but it didn't tell me its version.",
        "If Claude Code came from npm, its launcher can't run on its own; Anthropic's native installer gives me a claude.exe I can use.",
        "/opt/opencode is there, but it didn't tell me its version.",
      ]);
    });

    it("names an agent's env var, says why its file is no good, and leaves out its Find button", () => {
      const SET = "MAINFRAME_CLAUDE_BIN is set to /opt/claude, so that's the only place I look.";
      const CHANGE = 'Change it or unset it, then start Mainframe again.';
      const fromEnv = (claude: ProgramCheck) => blocks({ claudeFromEnv: true, claude })[0];
      expect(fromEnv({ state: 'missing', path: '/opt/claude' })).toEqual({
        check: 'agents',
        lines: [NONE, SET, "There's nothing there I can run.", CHANGE, OPENCODE_NOWHERE, ASK],
        buttons: ['install-claude', 'find-opencode', 'install-opencode', 'look-again'],
      });
      expect(fromEnv({ state: 'too-old', path: '/opt/claude', version: '2.0.1' }).lines.slice(1, 4)).toEqual([
        SET,
        `It's v2.0.1, and I need v${MIN_CLAUDE_VERSION} or newer.`,
        CHANGE,
      ]);
      expect(fromEnv({ state: 'broken', path: '/opt/claude' }).lines.slice(1, 4)).toEqual([SET, "It's there, but it didn't tell me its version.", CHANGE]);
      expect(
        blocks({ claude: missing, opencodeFromEnv: true, opencode: { state: 'missing', path: '/opt/opencode' } })[0].lines.slice(2, 5),
      ).toEqual(["MAINFRAME_OPENCODE_BIN is set to /opt/opencode, so that's the only place I look.", "There's nothing there I can run.", CHANGE]);
    });
  });

  describe('a found agent that is unticked does not count', () => {
    // A later start: only OpenCode was ticked, and it has moved; Claude Code is still installed.
    const moved: Over = { intro: 'moved', claude: found('/c', '2.1.319'), opencode: missing, ticked: { claude: false, opencode: true } };

    it('no agent works, so the failing one is not quiet', () => {
      expect(someAgentWorks(view(moved))).toBe(false);
      expect(someAgentWorks(view({ ...moved, ticked: { claude: true, opencode: true } }))).toBe(true);
    });

    it("gives the agents block for the agent that isn't found, with its buttons and Look again", () => {
      expect(blocks(moved)).toEqual([
        { check: 'agents', lines: [NONE, OPENCODE_NOWHERE, ASK], buttons: ['find-opencode', 'install-opencode', 'look-again'] },
      ]);
    });
  });

  describe('looked again', () => {
    it('adds the new-terminal hint after a git that is still missing, before the buttons', () => {
      expect(blocks({ lookedAgain: true, git: missing })).toEqual([
        {
          check: 'git',
          lines: [expect.stringContaining("I couldn't find git"), NEW_TERMINAL],
          buttons: ['install-git', 'look-again'],
        },
      ]);
    });

    it('adds it after agents that are still missing', () => {
      const [block] = blocks({ lookedAgain: true, claude: missing });
      expect(block.lines.at(-1)).toBe(NEW_TERMINAL);
      expect(block.buttons).toEqual(ALL_BUTTONS);
    });

    it('adds it once, to the last block, when git and the agents are missing', () => {
      const result = blocks({ lookedAgain: true, git: missing, claude: missing });
      expect(result.map((b) => b.check)).toEqual(['git', 'agents']);
      expect(result[0].lines).not.toContain(NEW_TERMINAL);
      expect(result[1].lines.at(-1)).toBe(NEW_TERMINAL);
    });

    it('puts it in the last block even when that block has agents that are only too old', () => {
      const result = blocks({
        lookedAgain: true,
        git: missing,
        claude: { state: 'too-old', path: '/opt/claude', version: '2.0.1' },
        opencode: { state: 'broken', path: '/opt/opencode' },
      });
      expect(result[0].lines).not.toContain(NEW_TERMINAL);
      expect(result[1].lines.at(-1)).toBe(NEW_TERMINAL);
    });

    it("is left out when nothing is missing: git that doesn't run, agents too old or broken", () => {
      expect(blocks({ lookedAgain: true, git: { state: 'broken', path: '/usr/bin/git' } })[0].lines).not.toContain(NEW_TERMINAL);
      const oldOrBroken = { claude: { state: 'too-old', path: '/p', version: '2.0.1' }, opencode: { state: 'broken', path: '/q' } } as const;
      expect(blocks({ lookedAgain: true, ...oldOrBroken })[0].lines).not.toContain(NEW_TERMINAL);
    });

    it('is left out for agents from their env vars: a new terminal changes nothing there', () => {
      const [block] = blocks({
        lookedAgain: true,
        claudeFromEnv: true,
        claude: { state: 'missing', path: '/opt/claude' },
        opencodeFromEnv: true,
        opencode: { state: 'missing', path: '/opt/opencode' },
      });
      expect(block.lines).not.toContain(NEW_TERMINAL);
    });

    it('is not there before the first look again', () => {
      expect(blocks({ git: missing })[0].lines).not.toContain(NEW_TERMINAL);
    });
  });

  describe('git and the agents both failing', () => {
    it("gives two blocks, git's first, with Look again only in the second", () => {
      expect(buttonsOf({ git: missing, claude: missing })).toEqual([['install-git'], ALL_BUTTONS]);
    });
  });

  it('puts Look again with the git block alone when only git fails', () => {
    expect(buttonsOf({ git: missing })).toEqual([['install-git', 'look-again']]);
  });
});

describe('agentStep', () => {
  const both: Over = { opencode: found('/home/me/.opencode/bin/opencode', '2.2.7') };
  const step = (over: Over, choice: AgentChoice) => agentStep(view(over), choice);

  it('gives a row per agent, ticked as the choice says, with its version', () => {
    expect(step(both, { ticked: ['claude', 'opencode'], defaultAgent: 'claude' }).rows).toEqual([
      { name: 'claude', works: true, ticked: true, version: '2.1.319', buttons: [] },
      { name: 'opencode', works: true, ticked: true, version: '2.2.7', buttons: [] },
    ]);
  });

  it('asks for the default, and says the New task box can still pick the other, only with two ticked', () => {
    const two = step(both, { ticked: ['claude', 'opencode'], defaultAgent: 'claude' });
    expect(two.showDefault).toBe(true);
    expect(two.hint).toBe('You can still pick the other one for a single task in the New task box. All of this can be changed in Settings later.');
    const one = step(both, { ticked: ['opencode'], defaultAgent: 'opencode' });
    expect(one.showDefault).toBe(false);
    expect(one.hint).toBe('OpenCode runs everything: the manager, the Todo sync and your tasks. Settings can change this later.');
  });

  it("offers How to install and Find on a row that doesn't work, and Find only while no env var names it", () => {
    const choice: AgentChoice = { ticked: ['opencode'], defaultAgent: 'opencode' };
    expect(step({ ...both, claude: missing }, choice).rows[0]).toEqual({
      name: 'claude',
      works: false,
      ticked: false,
      buttons: ['install-claude', 'find-claude'],
    });
    expect(step({ ...both, claude: missing, claudeFromEnv: true }, choice).rows[0].buttons).toEqual(['install-claude']);
  });
});
