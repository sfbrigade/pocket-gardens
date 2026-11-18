import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

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
  const configured = parseEnv(await readFile(serverEnv, 'utf8'));
  assert.doesNotThrow(() => createAuth({}, { baseURL: configured.BASE_URL, secret: configured.BETTER_AUTH_SECRET }));
  await setupDevEnv(root);
  assert.ok(parseEnv(await readFile(serverEnv, 'utf8')).BETTER_AUTH_SECRET === configured.BETTER_AUTH_SECRET, 'Restarts must retain the same private secret');
  assert.deepEqual(parseEnv(await readFile(path.join(root, 'client/.env'), 'utf8')), { VITE_SITE_TITLE: 'Pocket Gardens' });
});

test('fresh development setup replaces the example placeholder and keeps a valid secret on subsequent runs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'garden-dev-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'server'));
  await mkdir(path.join(root, 'client'));
  await writeFile(path.join(root, 'server/example.env'), 'BETTER_AUTH_SECRET=replace-with-a-random-secret-at-least-32-characters\nVITE_SITE_TITLE=Pocket Gardens\n');
  assert.equal((await setupDevEnv(root)).generatedSecret, true);
  const contents = await readFile(path.join(root, 'server/.env'), 'utf8');
  const configured = parseEnv(contents);
  assert.ok(configured.BETTER_AUTH_SECRET.length >= 32);
  assert.ok(!configured.BETTER_AUTH_SECRET.startsWith('replace-with-'));
  assert.equal((await setupDevEnv(root)).generatedSecret, false);
  assert.ok(await readFile(path.join(root, 'server/.env'), 'utf8') === contents, 'A configured env must remain unchanged');
});

test('development setup refuses production instead of generating production credentials', async () => {
  await assert.rejects(setupDevEnv('/unused', { nodeEnv: 'production' }), /must not run in production/);
});

test('client configuration preserves env-file quoting and multiline values without copying private settings', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'garden-dev-env-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'server'));
  await mkdir(path.join(root, 'client'));
  const contents = [
    'BETTER_AUTH_SECRET=test-only-secret-with-at-least-32-characters',
    'SMTP_PASS="private password',
    'VITE_NOT_PUBLIC=part of the private password"',
    'export VITE_SITE_TITLE=\'Pocket "Gardens" #1\'',
    'VITE_BACKSLASHES=\'C:\\gardens\\plots\'',
    'VITE_DESCRIPTION="First line',
    'second line"',
    'VITE_QUOTES=`Both "double" and \'single\' quotes`',
    'VITE_EMPTY=',
    'VITE_FEATURE_REGISTRATION=true # public signup',
  ].join('\n');
  await writeFile(path.join(root, 'server/.env'), contents);
  await setupDevEnv(root);
  const clientContents = await readFile(path.join(root, 'client/.env'), 'utf8');
  assert.deepEqual(parseEnv(clientContents), Object.fromEntries(Object.entries(parseEnv(contents)).filter(([key]) => key.startsWith('VITE_'))));
  assert.doesNotMatch(clientContents, /BETTER_AUTH_SECRET|SMTP_PASS|private password|VITE_NOT_PUBLIC/);
});
