/**
 * Whether node_modules holds what package-lock.json asks for, going by npm's record of the last install
 * (node_modules/.package-lock.json, null when there is none). An optional package may be missing, since npm
 * skips those built for another system.
 */
export function packagesInstalled(wanted, installed) {
  if (!installed) return false;
  return Object.entries(wanted.packages).every(([path, want]) => {
    if (path === '') return true;
    const have = installed.packages[path];
    return have ? have.version === want.version : want.optional === true;
  });
}
