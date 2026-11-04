import { test, expect } from '@playwright/test';
import { launchApp } from './launch';

test('opens the TheSource window', async () => {
  const { app, page } = await launchApp();
  expect(await page.title()).toBe('TheSource');
  await app.close();
});
