import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayMs, uploadRetentionDays, uploadUrlSeconds } from '#lib/upload-policy.js';

test('upload retention is explicit and longer than signed URL validity', () => {
  const before = process.env.PHOTO_UPLOAD_RETENTION_DAYS;
  try {
    delete process.env.PHOTO_UPLOAD_RETENTION_DAYS;
    assert.equal(uploadRetentionDays(), 7);
    process.env.PHOTO_UPLOAD_RETENTION_DAYS = '1';
    assert.equal(uploadRetentionDays(), 1);
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
