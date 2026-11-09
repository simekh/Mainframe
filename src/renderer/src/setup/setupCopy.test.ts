import { describe, expect, it } from 'vitest';
import { MIN_CLAUDE_VERSION, type ProgramCheck, type SetupView } from '../../../shared/types';
import { buttonLabel, checkLine, explanations, intro, type SetupButton } from './setupCopy';

const found = (path: string, version: string): ProgramCheck => ({ state: 'found', path, version });

/** A view where everything is found; each test changes what it is about. */
const view = (over: Partial<SetupView> = {}): SetupView => ({
  intro: 'welcome',
  git: found('/usr/bin/git', '2.56.0'),
  claude: found('/home/me/.local/bin/claude', '2.1.319'),
  claudeFromEnv: false,
  lookedAgain: false,
  askProject: false,
  platform: 'linux',
  ...over,
});

const blocks = (over: Partial<SetupView>) => explanations(view(over));
const buttonsOf = (over: Partial<SetupView>) => blocks(over).map((b) => b.buttons);

const NEW_TERMINAL =
  'Just installed it? A program installed after Mainframe started is often invisible to it: close Mainframe, open a new terminal and run npm start again.';

describe('checkLine', () => {
  it('says what a found git is', () => {
    expect(checkLine('git', found('/usr/bin/git', '2.56.0'))).toBe('found  git 2.56.0  ✓');
  });

  it('says where a found claude is and which version, in full', () => {
    expect(checkLine('claude', found('C:\\Users\\me\\.local\\bin\\claude.exe', '2.1.319'))).toBe(
      'found  C:\\Users\\me\\.local\\bin\\claude.exe · v2.1.319  ✓',
    );
  });

  it('says it is looking while a new look runs', () => {
    expect(checkLine('git', 'looking')).toBe('looking…');
    expect(checkLine('claude', 'looking')).toBe('looking…');
  });

  it('says a program that is nowhere is not found', () => {
    expect(checkLine('git', { state: 'missing' })).toBe('not found  ✗');
    expect(checkLine('claude', { state: 'missing' })).toBe('not found  ✗');
  });

  it('says a claude that is too old, with its path and version', () => {
    expect(checkLine('claude', { state: 'too-old', path: '/opt/claude', version: '2.0.1' })).toBe(
      '/opt/claude · v2.0.1, too old  ✗',
    );
  });

  it("says a program that doesn't run, with its path", () => {
    expect(checkLine('git', { state: 'broken', path: '/usr/bin/git' })).toBe("/usr/bin/git doesn't run  ✗");
    expect(checkLine('claude', { state: 'broken', path: '/opt/claude' })).toBe("/opt/claude doesn't run  ✗");
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
      "I keep a whole crew of Claude Code sessions busy at once, each on its own task in its own git worktree, and I only tap you on the shoulder when one of them needs you.",
      "Before we get going, I'm going to have a quick look around this computer.",
    ]);
    expect(lines[3].aside).toBe("(Nothing leaves it. I'm just checking what's installed.)");
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
  });

  it('labels the others the same everywhere', () => {
    const labels: Record<Exclude<SetupButton, 'find-claude'>, string> = {
      'install-claude': 'How to install ↗',
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
    expect(blocks({ askProject: true })).toEqual([
      {
        check: 'project',
        lines: ['All here. Last thing: which project should we start with?', "Any folder that's a git repository. You can open more later."],
        buttons: ['choose-project'],
      },
    ]);
  });

  it('asks about the project only when nothing is missing', () => {
    expect(blocks({ askProject: true, git: { state: 'missing' } }).map((b) => b.check)).toEqual(['git']);
  });

  describe('git', () => {
    it('is missing: asks to install it', () => {
      expect(blocks({ git: { state: 'missing' } })).toEqual([
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
      expect(blocks({ platform: 'darwin', git: { state: 'broken', path: '/usr/bin/git' } })).toEqual([
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
        expect(blocks({ platform, git: { state: 'broken', path: 'C:\\Git\\git.exe' } })[0].lines).toEqual([
          "I found git at C:\\Git\\git.exe, but it didn't run.",
        ]);
      }
    });
  });

  describe('claude missing', () => {
    const ASK = "If it's installed somewhere else, point me to it.\nIf it isn't, install it and I'll look again.";

    it('on Windows: names the three places looked in', () => {
      expect(blocks({ platform: 'win32', claude: { state: 'missing' } })).toEqual([
        {
          check: 'claude',
          lines: [
            "Hmm. I looked on your PATH, in %USERPROFILE%\\.local\\bin and in npm's global folder, and Claude Code wasn't in any of them.",
            ASK,
          ],
          buttons: ['find-claude', 'install-claude', 'look-again'],
        },
      ]);
    });

    it('on macOS and Linux: names the two places looked in', () => {
      for (const platform of ['darwin', 'linux'] as const) {
        expect(blocks({ platform, claude: { state: 'missing' } })).toEqual([
          {
            check: 'claude',
            lines: ["Hmm. I looked on your PATH and in ~/.local/bin, and Claude Code wasn't in either.", ASK],
            buttons: ['find-claude', 'install-claude', 'look-again'],
          },
        ]);
      }
    });
  });

  it('claude too old: asks to update it, and offers another file second', () => {
    expect(blocks({ claude: { state: 'too-old', path: '/opt/claude', version: '2.0.1' } })).toEqual([
      {
        check: 'claude',
        lines: [`This Claude Code is v2.0.1, and I need v${MIN_CLAUDE_VERSION} or newer. Run claude update in a terminal, then I'll look again.`],
        buttons: ['look-again', 'find-claude'],
      },
    ]);
  });

  describe('claude broken', () => {
    const broken: ProgramCheck = { state: 'broken', path: '/opt/claude' };

    it("on macOS and Linux: says it didn't tell its version", () => {
      for (const platform of ['darwin', 'linux'] as const) {
        expect(blocks({ platform, claude: broken })).toEqual([
          {
            check: 'claude',
            lines: ["/opt/claude is there, but it didn't tell me its version."],
            buttons: ['find-claude', 'install-claude', 'look-again'],
          },
        ]);
      }
    });

    it("on Windows: adds why an npm launcher doesn't work", () => {
      expect(blocks({ platform: 'win32', claude: { state: 'broken', path: 'C:\\npm\\claude.cmd' } })[0].lines).toEqual([
        "C:\\npm\\claude.cmd is there, but it didn't tell me its version.",
        "If Claude Code came from npm, its launcher can't run on its own; Anthropic's native installer gives me a claude.exe I can use.",
      ]);
    });
  });

  describe('claude from MAINFRAME_CLAUDE_BIN', () => {
    const fromEnv = (claude: ProgramCheck) => blocks({ claudeFromEnv: true, claude });
    const SET = "MAINFRAME_CLAUDE_BIN is set to /opt/claude, so that's the only place I look.";
    const CHANGE = 'Change it or unset it, then start Mainframe again.';

    it('names the variable, says why the file is no good, and offers only Look again', () => {
      expect(fromEnv({ state: 'missing', path: '/opt/claude' })).toEqual([
        { check: 'claude', lines: [SET, "There's nothing there I can run.", CHANGE], buttons: ['look-again'] },
      ]);
      expect(fromEnv({ state: 'too-old', path: '/opt/claude', version: '2.0.1' })).toEqual([
        { check: 'claude', lines: [SET, `It's v2.0.1, and I need v${MIN_CLAUDE_VERSION} or newer.`, CHANGE], buttons: ['look-again'] },
      ]);
      expect(fromEnv({ state: 'broken', path: '/opt/claude' })).toEqual([
        { check: 'claude', lines: [SET, "It's there, but it didn't tell me its version.", CHANGE], buttons: ['look-again'] },
      ]);
    });
  });

  describe('looked again', () => {
    it('adds the new-terminal hint after a git that is still missing, before the buttons', () => {
      expect(blocks({ lookedAgain: true, git: { state: 'missing' } })).toEqual([
        {
          check: 'git',
          lines: [expect.stringContaining("I couldn't find git"), NEW_TERMINAL],
          buttons: ['install-git', 'look-again'],
        },
      ]);
    });

    it('adds it after a claude that is still missing', () => {
      const [block] = blocks({ lookedAgain: true, claude: { state: 'missing' } });
      expect(block.lines.at(-1)).toBe(NEW_TERMINAL);
      expect(block.buttons).toEqual(['find-claude', 'install-claude', 'look-again']);
    });

    it('adds it once, to the last block, when both are missing', () => {
      const result = blocks({ lookedAgain: true, git: { state: 'missing' }, claude: { state: 'missing' } });
      expect(result.map((b) => b.check)).toEqual(['git', 'claude']);
      expect(result[0].lines).not.toContain(NEW_TERMINAL);
      expect(result[1].lines.at(-1)).toBe(NEW_TERMINAL);
    });

    it('puts it in the last block even when that block is a claude that is only too old', () => {
      const result = blocks({
        lookedAgain: true,
        git: { state: 'missing' },
        claude: { state: 'too-old', path: '/opt/claude', version: '2.0.1' },
      });
      expect(result[0].lines).not.toContain(NEW_TERMINAL);
      expect(result[1].lines.at(-1)).toBe(NEW_TERMINAL);
    });

    it("is left out when nothing is missing: git that doesn't run, claude too old or broken", () => {
      expect(blocks({ lookedAgain: true, git: { state: 'broken', path: '/usr/bin/git' } })[0].lines).not.toContain(NEW_TERMINAL);
      expect(blocks({ lookedAgain: true, claude: { state: 'too-old', path: '/p', version: '2.0.1' } })[0].lines).not.toContain(NEW_TERMINAL);
      expect(blocks({ lookedAgain: true, claude: { state: 'broken', path: '/p' } })[0].lines).not.toContain(NEW_TERMINAL);
    });

    it('is left out for a claude from MAINFRAME_CLAUDE_BIN: a new terminal changes nothing there', () => {
      const [block] = blocks({ lookedAgain: true, claudeFromEnv: true, claude: { state: 'missing', path: '/opt/claude' } });
      expect(block.lines).not.toContain(NEW_TERMINAL);
    });

    it('is not there before the first look again', () => {
      expect(blocks({ git: { state: 'missing' } })[0].lines).not.toContain(NEW_TERMINAL);
    });
  });

  describe('git and claude both failing', () => {
    it("gives two blocks, git's first, with Look again only in the second", () => {
      expect(buttonsOf({ git: { state: 'missing' }, claude: { state: 'missing' } })).toEqual([
        ['install-git'],
        ['find-claude', 'install-claude', 'look-again'],
      ]);
      expect(blocks({ git: { state: 'missing' }, claude: { state: 'missing' } }).map((b) => b.check)).toEqual(['git', 'claude']);
    });

    it('keeps each block first button its primary one', () => {
      const result = blocks({ git: { state: 'broken', path: '/g' }, claude: { state: 'too-old', path: '/c', version: '2.0.1' } });
      expect(result.map((b) => b.buttons[0])).toEqual(['install-git', 'look-again']);
    });

    it('gives Look again alone for a git that fails beside a claude from MAINFRAME_CLAUDE_BIN', () => {
      expect(
        buttonsOf({ git: { state: 'missing' }, claudeFromEnv: true, claude: { state: 'missing', path: '/opt/claude' } }),
      ).toEqual([['install-git'], ['look-again']]);
    });
  });

  it('puts Look again with the git block alone when only git fails', () => {
    expect(buttonsOf({ git: { state: 'missing' } })).toEqual([['install-git', 'look-again']]);
  });
});
