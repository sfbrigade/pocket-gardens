import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import Base from '#models/base.js';

test('database-backed model fields are visible to response validation', () => {
  const model = new Base({ email: 'email' }, { email: 'test@example.com' });
  assert.deepEqual(z.object({ email: z.string() }).parse(model), { email: 'test@example.com' });
});
