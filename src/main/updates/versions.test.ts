import { describe, expect, it } from 'vitest';
import { compareVersions, newestRelease, notesSince, parseTag } from './versions';

const CHANGELOG = [
  '# Changelog',
  '',
  '## Unreleased',
  '- not out yet',
  '',
  '## 0.5.0 · 17 Nov 2026',
  '- five',
  '',
  '## 0.4.1 · 10 Nov 2026',
  '- four one',
  '',
  '## 0.4.0 · 1 Nov 2026',
  '- four',
  '',
].join('\n');

describe('parseTag', () => {
  it('accepts plain v<major>.<minor>.<patch> tags', () => {
    expect(parseTag('v0.1.0')).toEqual([0, 1, 0]);
    expect(parseTag('v10.20.30')).toEqual([10, 20, 30]);
  });

  it('rejects everything else, pre-releases included', () => {
    for (const tag of ['v1.2', 'v1.2.3-beta.1', '1.2.3', 'vx.y.z', 'v1.2.3.4', ' v1.2.3', 'v1.02.0', 'v01.2.3', 'v1.2.03']) {
      expect(parseTag(tag)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('compares number by number, not as text', () => {
    expect(compareVersions([0, 10, 0], [0, 9, 0])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [0, 99, 99])).toBeGreaterThan(0);
    expect(compareVersions([0, 0, 1], [0, 0, 2])).toBeLessThan(0);
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
  });
});

describe('newestRelease', () => {
  it('picks the highest release tag and ignores the rest', () => {
    expect(newestRelease(['v0.9.0', 'v0.10.0', 'v1.0.0-rc.1', 'junk'])).toEqual([0, 10, 0]);
  });

  it('is null without a release tag', () => {
    expect(newestRelease([])).toBeNull();
    expect(newestRelease(['junk'])).toBeNull();
  });
});

describe('notesSince', () => {
  it('returns the sections after current up to latest, newest first', () => {
    const notes = notesSince(CHANGELOG, [0, 4, 0], [0, 5, 0]);
    expect(notes).toContain('## 0.5.0 · 17 Nov 2026');
    expect(notes).toContain('## 0.4.1 · 10 Nov 2026');
    expect(notes.indexOf('0.5.0')).toBeLessThan(notes.indexOf('0.4.1'));
    expect(notes).not.toContain('Unreleased');
    expect(notes).not.toContain('0.4.0');
  });

  it('leaves out sections newer than latest', () => {
    const notes = notesSince(CHANGELOG, [0, 4, 0], [0, 4, 1]);
    expect(notes).toContain('0.4.1');
    expect(notes).not.toContain('0.5.0');
  });

  it('with no current version returns every section up to latest', () => {
    const notes = notesSince(CHANGELOG, null, [0, 5, 0]);
    expect(notes).toContain('0.5.0');
    expect(notes).toContain('0.4.1');
    expect(notes).toContain('0.4.0');
    expect(notes).not.toContain('Unreleased');
  });

  it('says so when there is nothing to show', () => {
    expect(notesSince(null, null, [0, 1, 0])).toBe('No notes for this release.');
    expect(notesSince(CHANGELOG, [0, 5, 0], [0, 5, 0])).toBe('No notes for this release.');
  });
});
