/**
 * The flags `npm start` (`preview`) and `npm run dev` (`dev`) give electron-vite after their command.
 * Ubuntu 24.04 and later block the unprivileged user namespaces Chromium's sandbox needs, and Electron
 * aborts with "No usable sandbox". The sandbox is turned off only there, and only while Electron's
 * setuid helper (the other way to sandbox) isn't set up.
 *
 * `restriction` is the content of /proc/sys/kernel/apparmor_restrict_unprivileged_userns, and `helper`
 * is the uid and mode of Electron's `chrome-sandbox`; each is null when it can't be read.
 */
export function sandboxFlags(platform, restriction, helper) {
  const blocked = platform === 'linux' && restriction?.trim() === '1';
  const helperSetUp = helper !== null && helper.uid === 0 && (helper.mode & 0o4000) !== 0;
  return blocked && !helperSetUp ? ['--noSandbox'] : [];
}
