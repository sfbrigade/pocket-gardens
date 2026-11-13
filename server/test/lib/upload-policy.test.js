import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dayMs, uploadExpiresAt, uploadRetentionDays, uploadUrlSeconds } from '#lib/upload-policy.js';

const exec = promisify(execFile);

test('upload retention is explicit and longer than signed URL validity', () => {
  const before = process.env.PHOTO_UPLOAD_RETENTION_DAYS;
  try {
    delete process.env.PHOTO_UPLOAD_RETENTION_DAYS;
    assert.equal(uploadRetentionDays(), 7);
    assert.equal(uploadExpiresAt(new Date(0)).getTime(), 7 * dayMs);
    process.env.PHOTO_UPLOAD_RETENTION_DAYS = '1';
    assert.equal(uploadExpiresAt(new Date(0)).getTime(), dayMs);
    assert.ok(uploadUrlSeconds * 1000 < dayMs);
    for (const value of ['0', '366', '1.5', 'invalid', '']) {
      process.env.PHOTO_UPLOAD_RETENTION_DAYS = value;
      assert.throws(uploadRetentionDays, /PHOTO_UPLOAD_RETENTION_DAYS/);
    }
  } finally {
    if (before === undefined) delete process.env.PHOTO_UPLOAD_RETENTION_DAYS;
    else process.env.PHOTO_UPLOAD_RETENTION_DAYS = before;
  }
});

test('policy preparation preserves unrelated bucket rules and is repeatable without storage access', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pg-policy-'));
  try {
    const file = path.join(dir, 'existing.json');
    const unrelated = { ID: 'keep-archives', Status: 'Enabled', Filter: { Prefix: 'archives/' }, Expiration: { Days: 365 } };
    const existing = { Rules: [unrelated], TransitionDefaultMinimumObjectSize: 'all_storage_classes_128K' };
    const original = JSON.stringify(existing);
    await writeFile(file, original);
    const env = { ...process.env, PHOTO_UPLOAD_RETENTION_DAYS: '3', AWS_S3_ENDPOINT: 'http://127.0.0.1:1' };
    const { stdout } = await exec(process.execPath, ['bin/photo-lifecycle-policy.js', file], { env });
    assert.equal(await readFile(file, 'utf8'), original);
    const proposed = JSON.parse(stdout);
    assert.deepEqual(proposed.Rules[0], unrelated);
    assert.equal(proposed.TransitionDefaultMinimumObjectSize, existing.TransitionDefaultMinimumObjectSize);
    const added = proposed.Rules.slice(1);
    assert.equal(added.length, 2);
    assert.ok(added.every(({ Filter }) => Filter.Prefix === '_uploads/'));
    assert.equal(added[0].Expiration.Days, 3);
    assert.equal(added[0].NoncurrentVersionExpiration.NoncurrentDays, 3);
    assert.equal(added[1].Expiration.ExpiredObjectDeleteMarker, true);
    await writeFile(file, stdout);
    assert.equal((await exec(process.execPath, ['bin/photo-lifecycle-policy.js', file], { env })).stdout, stdout);
    await writeFile(file, '{}');
    await assert.rejects(exec(process.execPath, ['bin/photo-lifecycle-policy.js', file], { env }), /Rules array/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
