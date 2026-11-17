import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'dotenv';

import { setupDevEnv } from '../../bin/setup-dev-env.mjs';
import { createAuth } from '#lib/auth.js';

test('development startup upgrades an existing env to a persistent valid auth secret', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'garden-dev-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'server'));
  await mkdir(path.join(root, 'client'));
  const serverEnv = path.join(root, 'server/.env');
  await writeFile(serverEnv, 'BASE_URL=http://localhost:3333\nVITE_SITE_TITLE=Pocket Gardens\n');
  await setupDevEnv(root);
  const configured = parse(await readFile(serverEnv));
  assert.doesNotThrow(() => createAuth({}, { baseURL: configured.BASE_URL, secret: configured.BETTER_AUTH_SECRET }));
  await setupDevEnv(root);
  assert.ok(parse(await readFile(serverEnv)).BETTER_AUTH_SECRET === configured.BETTER_AUTH_SECRET, 'Restarts must retain the same private secret');
  assert.deepEqual(parse(await readFile(path.join(root, 'client/.env'))), { VITE_SITE_TITLE: 'Pocket Gardens' });
});

test('fresh development setup replaces the example placeholder and keeps a valid secret on subsequent runs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'garden-dev-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'server'));
  await mkdir(path.join(root, 'client'));
  await writeFile(path.join(root, 'server/example.env'), 'BETTER_AUTH_SECRET=replace-with-a-random-secret-at-least-32-characters\nVITE_SITE_TITLE=Pocket Gardens\n');
  assert.equal((await setupDevEnv(root)).generatedSecret, true);
  const contents = await readFile(path.join(root, 'server/.env'), 'utf8');
  const configured = parse(contents);
  assert.ok(configured.BETTER_AUTH_SECRET.length >= 32);
  assert.ok(!configured.BETTER_AUTH_SECRET.startsWith('replace-with-'));
  assert.equal((await setupDevEnv(root)).generatedSecret, false);
  assert.ok(await readFile(path.join(root, 'server/.env'), 'utf8') === contents, 'A configured env must remain unchanged');
});

test('development setup refuses production instead of generating production credentials', async () => {
  await assert.rejects(setupDevEnv('/unused', { nodeEnv: 'production' }), /must not run in production/);
});
