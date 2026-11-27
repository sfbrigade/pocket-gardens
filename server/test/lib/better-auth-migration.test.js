import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { createClient } from '#prisma/client.js';

const migrations = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const serverDir = fileURLToPath(new URL('../../', import.meta.url));
const migrationName = '20261116000000_better_auth';

test('Better Auth upgrades existing accounts without replacing garden identities', async (t) => {
  const container = await new PostgreSqlContainer('postgres:18.3').start();
  t.after(() => container.stop());
  const databaseUrl = container.getConnectionUri();
  const prisma = createClient(databaseUrl);
  t.after(() => prisma.$disconnect());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'garden-auth-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = (await readdir(migrations)).filter(name => /^\d+_/.test(name)).sort();
  const script = path.join(directory, 'migrations.sql');
  async function execute (names) {
    const sql = await Promise.all(names.map(name => readFile(path.join(migrations, name, 'migration.sql'), 'utf8')));
    await writeFile(script, sql.join('\n'));
    await promisify(execFile)('npx', ['prisma', 'db', 'execute', '--file', script], {
      cwd: serverDir, env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  }
  await execute(names.filter(name => name < migrationName));

  const [admin, member] = await prisma.$queryRaw`INSERT INTO "User"
    (id, "firstName", "lastName", email, "hashedPassword", "isAdmin", "deactivatedAt", picture, "createdAt", "updatedAt") VALUES
    ('555740af-17e9-48a3-93b8-d5236dfd2c29', 'Existing', 'Admin', 'Existing.Admin@example.com', 'legacy-placeholder', true, NULL, 'avatar.jpg', '2025-01-01', '2025-01-02'),
    ('dab5dff3-360d-4dbb-98dd-1990dfb5c4c5', 'Existing', 'Member', 'member@example.com', 'unused-placeholder', false, '2025-02-01', NULL, '2025-01-01', '2025-02-01')
    RETURNING *`;
  const invite = await prisma.invite.create({
    data: {
      firstName: 'Existing', email: member.email, createdById: admin.id, acceptedById: member.id, acceptedAt: new Date('2025-01-03'),
    }
  });
  const person = await prisma.person.create({ data: { airtableId: 'existing-person', userId: member.id, firstName: 'Existing' } });
  const [plot] = await prisma.$queryRaw`INSERT INTO "Plot"
    ("airtableId", "lastVolunteerId", "sethsNotes", "updatedAt")
    VALUES ('existing-plot', ${person.id}::uuid, ${'Legacy permission note\nSecond line'}, now())
    RETURNING *`;
  await prisma.plotAssignedVolunteer.create({ data: { plotId: plot.id, personId: person.id } });
  const record = await prisma.maintenanceRecord.create({ data: { airtableId: 'existing-visit', plotId: plot.id, volunteerId: person.id, activity: ['Watering'] } });
  const before = {
    invite: await prisma.invite.findUnique({ where: { id: invite.id } }),
    person: await prisma.person.findUnique({ where: { id: person.id } }),
    plot,
    record: await prisma.maintenanceRecord.findUnique({ where: { id: record.id } }),
    assignments: await prisma.plotAssignedVolunteer.findMany(),
  };

  await execute([migrationName]);
  const pending = await prisma.user.create({
    data: { firstName: 'Pending', lastName: 'Signup', name: 'Pending Signup', email: 'pending-after-cutover@example.com' },
  });
  assert.equal(pending.emailVerified, false);
  assert.equal(pending.legacyHashedPassword, null);
  await execute(names.filter(name => name > migrationName));
  const users = await prisma.user.findMany({ where: { id: { in: [admin.id, member.id] } }, orderBy: { email: 'asc' } });
  assert.deepEqual(users.map(user => user.id), [admin.id, member.id]);
  for (const [old, user] of [[admin, users[0]], [member, users[1]]]) {
    assert.equal(user.email, old.email);
    assert.equal(user.name, `${old.firstName} ${old.lastName}`);
    assert.equal(user.firstName, old.firstName);
    assert.equal(user.lastName, old.lastName);
    assert.equal(user.picture, old.picture);
    assert.equal(user.emailVerified, true, 'Pre-existing Pocket Gardens accounts are trusted as verified during cutover');
    assert.equal(user.role, old.isAdmin ? 'admin' : 'user');
    assert.equal(user.banned, old.deactivatedAt !== null);
    assert.equal(user.legacyHashedPassword, old.hashedPassword);
    assert.equal(user.legacyIsAdmin, old.isAdmin);
    assert.deepEqual(user.legacyDeactivatedAt, old.deactivatedAt);
    assert.deepEqual(user.createdAt, old.createdAt);
    assert.deepEqual(user.updatedAt, old.updatedAt);
  }
  assert.deepEqual(await prisma.invite.findUnique({ where: { id: invite.id } }), before.invite);
  assert.deepEqual(await prisma.person.findUnique({ where: { id: person.id } }), before.person);
  const { sethsNotes, ...oldPlot } = before.plot;
  assert.deepEqual(await prisma.plot.findUnique({ where: { id: plot.id } }), {
    ...oldPlot,
    staffPermissionNotes: null,
    gardenCareNote: sethsNotes,
    permissionAdditionalNote: null,
    createdById: null,
    gardenCareNoteAuthorId: null,
    permissionAdditionalNoteAuthorId: null,
    environmentalNotesAuthorId: null,
  });
  assert.deepEqual(await prisma.maintenanceRecord.findUnique({ where: { id: record.id } }), before.record);
  assert.deepEqual(await prisma.plotAssignedVolunteer.findMany(), before.assignments);
  assert.equal(await prisma.account.count(), 0, 'Legacy passwords are not imported');
  assert.equal(await prisma.session.count(), 0, 'Legacy sessions are not imported');
  assert.equal((await prisma.user.findUnique({ where: { email: 'EXISTING.ADMIN@EXAMPLE.COM' } })).id, admin.id);
  assert.equal((await prisma.user.findUnique({ where: { id: pending.id } })).emailVerified, false, 'The backfill must not verify pending Better Auth signups');
  const passwordless = await prisma.user.create({ data: { firstName: 'New', lastName: 'User', name: 'New User', email: 'new@example.com' } });
  assert.equal(passwordless.emailVerified, false, 'New accounts must still default to unverified');
  assert.equal(passwordless.legacyHashedPassword, null, 'Retained legacy fields must permit passwordless signup');
});
