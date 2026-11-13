import { BrowserWindow, screen } from 'electron';
import { IPC } from '../../shared/ipc';
import type { DiffView } from '../../shared/types';
import type { DiffWindowControl } from '../ipc';
import { APP_BACKGROUND, webPreferences } from '../windowOptions';
import { diffWindowTitle, readDiffWindowBounds, restoreBounds, writeDiffWindowBounds } from './diffWindowState';

/**
 * The one diff window, above Mainframe's: made on the first open, destroyed when it closes, and
 * loaded with whichever task was clicked last, in any project.
 */
export class DiffWindow implements DiffWindowControl {
  private win: BrowserWindow | null = null;
  /** Held only while the window exists: a view can be millions of characters. */
  private view: DiffView | null = null;
  private latestSeq = 0;
  private seq = 0;

  constructor(
    private readonly o: {
      parent: BrowserWindow;
      dataDir: string;
      /** An e2e run on the Mac: the window never shows, as Mainframe's doesn't. */
      hidden: boolean;
      /** Sets up its page as Mainframe's is, and loads it. */
      prepare: (win: BrowserWindow) => void;
      /** The windows' zoom at the moment, which a new window opens at. */
      zoomFactor: () => number;
      warn: (msg: string) => void;
    },
  ) {}

  nextSeq(): number {
    return ++this.seq;
  }

  show(view: DiffView): void {
    // A read can land after Mainframe's window closed, while the app waits to quit.
    if (this.o.parent.isDestroyed()) return;
    // A slow read for an earlier click must not replace a later one's, and one from before a close must
    // not reopen the window the user just closed (`closed`).
    if (view.seq < this.latestSeq) return;
    this.latestSeq = view.seq;
    this.view = view;
    if (this.win) {
      this.win.setTitle(diffWindowTitle(view));
      this.win.webContents.send(IPC.diffChanged, view);
      if (!this.o.hidden) {
        if (this.win.isMinimized()) this.win.restore();
        this.win.focus();
      }
      return;
    }
    const { parent, dataDir, hidden, warn } = this.o;
    const bounds = restoreBounds(
      readDiffWindowBounds(dataDir, warn),
      screen.getAllDisplays().map((d) => d.workArea),
      parent.getBounds(),
    );
    const win = new BrowserWindow({
      ...bounds,
      parent,
      title: diffWindowTitle(view),
      show: !hidden,
      // macOS only: the saved size may be larger than an e2e runner's screen.
      enableLargerThanScreen: hidden,
      backgroundColor: APP_BACKGROUND,
      minWidth: 480,
      minHeight: 320,
      webPreferences: webPreferences(this.o.zoomFactor()),
    });
    // The page sets no title of its own, and index.html's would replace the task's.
    win.on('page-title-updated', (event) => event.preventDefault());
    // Closing must never fail, so a bounds file that can't be written is only warned of.
    win.on('close', () => {
      try {
        writeDiffWindowBounds(dataDir, win.getNormalBounds());
      } catch (err) {
        warn(`Could not save the diff window's place (${String(err)})`);
      }
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.view = null;
      this.latestSeq = this.seq + 1;
    });
    this.win = win;
    // The page asks for the latest view (`current`) once it has loaded.
    this.o.prepare(win);
  }

  current(): DiffView | null {
    return this.view;
  }

  close(): void {
    this.win?.close();
  }
}
