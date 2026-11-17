#!/usr/bin/env node
// Stands in for `codex` in e2e tests: the stand-in for `claude` (e2e/fake-claude.cjs), acting as Codex.
// On Windows the tests run a copy of fake-claude's .exe named fake-codex.exe instead (e2e/globalSetup.ts).
'use strict';
process.env.FAKE_AGENT = 'codex';
require('./fake-claude.cjs');
