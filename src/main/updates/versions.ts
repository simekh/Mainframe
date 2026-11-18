export type Version = [number, number, number];

const NO_NOTES = 'No notes for this release.';

/**
 * Reads a release tag. Only a plain `v<major>.<minor>.<patch>` counts, with no leading zeros, so pre-release tags and
 * look-alikes such as `v1.02.0` are never offered.
 */
export function parseTag(tag: string): Version | null {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function formatVersion(v: Version): string {
  return v.join('.');
}

export function newestRelease(tags: string[]): Version | null {
  let newest: Version | null = null;
  for (const tag of tags) {
    const version = parseTag(tag);
    if (version && (!newest || compareVersions(version, newest) > 0)) newest = version;
  }
  return newest;
}

/**
 * The changelog sections for the releases after `current` up to `latest`, newest first, each with its heading.
 * A heading with no version (`## Unreleased`) is never part of a release. A null `current` means every release.
 */
export function notesSince(changelog: string | null, current: Version | null, latest: Version): string {
  const sections: { version: Version; text: string }[] = [];
  for (const part of (changelog ?? '').split(/^(?=## )/m)) {
    if (!part.startsWith('## ')) continue;
    const found = /\d+\.\d+\.\d+/.exec(part.split('\n', 1)[0]);
    if (!found) continue;
    const version = parseTag(`v${found[0]}`);
    if (!version || compareVersions(version, latest) > 0) continue;
    if (current && compareVersions(version, current) <= 0) continue;
    sections.push({ version, text: part.trim() });
  }
  if (sections.length === 0) return NO_NOTES;
  sections.sort((a, b) => compareVersions(b.version, a.version));
  return sections.map((s) => s.text).join('\n\n');
}
