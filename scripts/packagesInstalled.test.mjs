import { describe, expect, it } from 'vitest';
import { packagesInstalled } from './packagesInstalled.mjs';

const lock = (packages) => ({ lockfileVersion: 3, packages });

const wanted = lock({
  '': { name: 'mainframe' },
  'node_modules/electron': { version: '44.10.2', dev: true },
  'node_modules/zod': { version: '4.6.7' },
  'node_modules/lightningcss-win32-x64-msvc': { version: '1.30.0', optional: true, dev: true, os: ['win32'] },
});

describe('packagesInstalled', () => {
  it('is false before the first install', () => {
    expect(packagesInstalled(wanted, null)).toBe(false);
  });

  it('is true when every package is installed at its locked version, skipping optional ones for other systems', () => {
    const installed = lock({
      'node_modules/electron': { version: '44.10.2', dev: true },
      'node_modules/zod': { version: '4.6.7' },
    });
    expect(packagesInstalled(wanted, installed)).toBe(true);
  });

  it('is false when a package the lockfile added since the last install is missing', () => {
    const installed = lock({ 'node_modules/electron': { version: '44.10.2', dev: true } });
    expect(packagesInstalled(wanted, installed)).toBe(false);
  });

  it('is false when a package is installed at another version than the lockfile now asks for', () => {
    const installed = lock({
      'node_modules/electron': { version: '43.0.0', dev: true },
      'node_modules/zod': { version: '4.6.7' },
    });
    expect(packagesInstalled(wanted, installed)).toBe(false);
  });

  it('is false when an installed optional package is at another version', () => {
    const installed = lock({
      'node_modules/electron': { version: '44.10.2', dev: true },
      'node_modules/zod': { version: '4.6.7' },
      'node_modules/lightningcss-win32-x64-msvc': { version: '1.29.0', optional: true, dev: true },
    });
    expect(packagesInstalled(wanted, installed)).toBe(false);
  });
});
