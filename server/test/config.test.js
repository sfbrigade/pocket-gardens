import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

test('server configuration loads its own env file and preserves deployment overrides', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'garden-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config.mjs');
  await copyFile(new URL('../config.js', import.meta.url), configPath);
  await writeFile(path.join(root, '.env'), 'GARDEN_CONFIG_FILE="Pocket Gardens #1"\nGARDEN_CONFIG_OVERRIDE=from-file\n');

  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import ${JSON.stringify(pathToFileURL(configPath).href)}; console.log(JSON.stringify([process.env.GARDEN_CONFIG_FILE, process.env.GARDEN_CONFIG_OVERRIDE]));`,
  ], {
    cwd: os.tmpdir(),
    env: { ...process.env, GARDEN_CONFIG_FILE: undefined, GARDEN_CONFIG_OVERRIDE: 'from-deployment' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['Pocket Gardens #1', 'from-deployment']);
});

test('production configuration works without an env file', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'garden-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config.mjs');
  await copyFile(new URL('../config.js', import.meta.url), configPath);

  const result = spawnSync(process.execPath, [configPath], {
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
