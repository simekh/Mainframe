#!/usr/bin/env node
// Stands in for `opencode` in e2e tests: the stand-in for `claude` (e2e/fake-claude.cjs), acting as OpenCode.
// On Windows the tests run a copy of fake-claude's .exe named fake-opencode.exe instead (e2e/globalSetup.ts).
'use strict';
process.env.FAKE_AGENT = 'opencode';
require('./fake-claude.cjs');
