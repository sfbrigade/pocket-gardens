import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../bin/create-admin.sh', import.meta.url));

test('bootstrap admin forwards names and email safely to the CLI', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bootstrap admin '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'npx'), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` };
  for (const [firstName, lastName] of [['Alice', 'Smith'], ['Anne "Annie"', "O'Brien\\Smith\nJr."]]) {
    const email = 'admin@example.com';
    const { stdout } = await run(script, [firstName, lastName, email], { cwd: directory, env });
    const args = JSON.parse(stdout);
    assert.equal(args[0], 'auth');
    assert.equal(args[1], 'create-admin');
    assert.equal(path.resolve(args[3]), fileURLToPath(new URL('../auth.js', import.meta.url)));
    assert.deepEqual(args.slice(4, 8), ['--email', email, '--name', `${firstName} ${lastName}`]);
    assert.equal(args[8], '--data');
    assert.deepEqual(JSON.parse(args[9]), { firstName, lastName });
  }
  await assert.rejects(run(script, ['Alice'], { env }), error => error.code === 1 && error.stdout.includes('Usage:'));
});
