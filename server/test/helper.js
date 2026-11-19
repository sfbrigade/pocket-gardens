// This file contains code that we reuse
// between our tests.

import util from 'node:util';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import helper from 'fastify-cli/helper.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { StatusCodes } from 'http-status-codes';
import * as nodemailerMock from 'nodemailer-mock';

import { GenericContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  Builder,
  fixturesIterator,
  Loader,
  Parser,
  Resolver,
} from '@sfcivictech/prisma-fixtures';
import { hashPassword } from 'better-auth/crypto';
import { createClient } from '#prisma/client.js';

import s3 from '#lib/s3.js';
import mailer, { configureMailer } from '#lib/mailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AppPath = path.join(__dirname, '..', 'app.js');
const password = 'a sufficiently long passphrase';
const authSecret = 'test-only-secret-with-at-least-32-characters';

// Dependency mocks for testing
configureMailer(nodemailerMock);

// Fill in this config with all the configurations
// needed for testing the application
function config () {
  return {
    skipOverride: true // Register our application with fastify-plugin
  };
}

const pendingMail = [];

async function waitForMail () {
  await Promise.allSettled(pendingMail.splice(0));
}

// automatically build and tear down our instance
async function build (t) {
  const send = mailer.send;
  t.mock.method(mailer, 'send', (...args) => {
    const delivery = send(...args);
    pendingMail.push(delivery);
    return delivery;
  });
  t.afterEach(waitForMail);
  t.after(waitForMail);
  const cleanups = [];
  t.after(async () => {
    const errors = [];
    for (const cleanup of cleanups.toReversed()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Test resource cleanup failed');
  });
  const authEnv = {
    SMTP_ENABLED: process.env.SMTP_ENABLED,
    VITE_FEATURE_REGISTRATION: process.env.VITE_FEATURE_REGISTRATION,
  };
  t.beforeEach(() => {
    process.env.SMTP_ENABLED = 'true';
    process.env.VITE_FEATURE_REGISTRATION = 'true';
  });
  t.after(() => {
    for (const [key, value] of Object.entries(authEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  // disable the ryuk cleanup container, cannot connect from the compose network
  process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
  const compose = YAML.parse(await fs.readFile(path.join(__dirname, '../..', 'compose.yml'), 'utf8'));
  // extract current version of postgres image being used, start a new test container
  let dbContainer = new PostgreSqlContainer(compose.services.db.image);
  if (!process.env.CI) {
    dbContainer = dbContainer.withNetworkMode('pocket-gardens');
  }
  const startedDbContainer = await dbContainer.start();
  cleanups.push(() => startedDbContainer.stop());
  // set up the default template (template1) with the schema and fixtures
  const TEMPLATE_DATABASE_URL = `postgresql://${startedDbContainer.getUsername()}:${startedDbContainer.getPassword()}@${startedDbContainer.getHost()}:${startedDbContainer.getPort()}/template1`;
  // run the migrations
  await util.promisify(exec)(`DATABASE_URL=${TEMPLATE_DATABASE_URL} npx prisma migrate deploy`);
  const prisma = createClient(TEMPLATE_DATABASE_URL);
  cleanups.push(() => prisma.$disconnect());
  // load fixtures
  const loader = new Loader();
  const resolver = new Resolver();
  const builder = new Builder(prisma, new Parser());
  loader.load(path.resolve(__dirname, 'fixtures/db'));
  const fixtures = resolver.resolve(loader.fixtureConfigs);
  for (const fixture of fixturesIterator(fixtures)) {
    await builder.build(fixture);
  }
  // Test-only credentials use Better Auth's password format.
  const password = await hashPassword('test');
  for (const user of await prisma.user.findMany()) {
    await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: 'credential', password } });
  }
  process.env.BASE_URL = 'http://localhost:3333';
  process.env.BETTER_AUTH_SECRET = authSecret;
  // configure test database url
  process.env.DATABASE_URL = `postgresql://${startedDbContainer.getUsername()}:${startedDbContainer.getPassword()}@${startedDbContainer.getHost()}:${startedDbContainer.getPort()}/${startedDbContainer.getDatabase()}`;
  t.prisma = createClient(process.env.DATABASE_URL);
  cleanups.push(() => t.prisma.$disconnect());

  // set up a new storage container
  let storageContainer = new GenericContainer(compose.services.storage.image)
    .withEntrypoint(['rustfs', '/data'])
    .withExposedPorts(9000)
    // A listening S3 port can still return plaintext 503s during storage startup.
    .withWaitStrategy(Wait.forHttp('/health/ready', 9000).forStatusCode(200));
  if (!process.env.CI) {
    storageContainer = storageContainer.withNetworkMode('pocket-gardens');
  }
  const startedStorageContainer = await storageContainer.start();
  cleanups.push(() => startedStorageContainer.stop());
  process.env.AWS_S3_ACCESS_KEY_ID = 'rustfsadmin';
  process.env.AWS_S3_SECRET_ACCESS_KEY = 'rustfsadmin';
  process.env.AWS_S3_BUCKET = 'app';
  process.env.AWS_S3_REGION = 'us-east-1';
  process.env.AWS_S3_ENDPOINT = `http://${startedStorageContainer.getHost()}:${startedStorageContainer.getMappedPort(9000)}`;
  await s3.createBucket(process.env.AWS_S3_BUCKET);

  // you can set all the options supported by the fastify CLI command
  const argv = ['--options', AppPath];

  // fastify-plugin ensures that all decorators
  // are exposed for testing purposes, this is
  // different from the production setup
  const app = await helper.build(argv, { ...config(), prisma: t.prisma });
  cleanups.push(() => app.close());

  // recreate the database from the template created above
  async function recreateDb () {
    await t.prisma.$disconnect();
    await app.prisma.$disconnect();
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${startedDbContainer.getDatabase()} WITH (FORCE)`);
    await sleep(100);
    await prisma.$executeRawUnsafe(`CREATE DATABASE ${startedDbContainer.getDatabase()} `);
    await app.prisma.$connect();
    await t.prisma.$connect();
  }
  await recreateDb();

  t.afterEach(async () => {
    // clear sent mail
    nodemailerMock.mock.reset();
    // clear test assets
    await s3.deleteObjects('_test/');
    // reset test database after each test
    return recreateDb();
  });

  return app;
}

function cookieHeaders (response) {
  return { cookie: response.cookies.map(({ name, value }) => `${name}=${value}`).join('; ') };
}

async function authenticate (app, email, password) {
  const response = await app.inject().post('/api/auth/sign-in/email').headers({ origin: process.env.BASE_URL }).payload({
    email,
    password,
  });
  if (response.statusCode !== StatusCodes.OK) {
    throw new Error(`Fixture sign-in failed: ${response.statusCode}`);
  }
  // Authentication is fixture setup; rate limits have their own integration test.
  await app.prisma.rateLimit.deleteMany();
  // send back headers needed to authenticate
  return {
    ...cookieHeaders(response),
  };
}

async function mailToken (mail) {
  await waitForMail();
  const text = mail.getSentMail().at(-1).text;
  const url = new URL(text.match(/http[^\s]+/)[0]);
  return url.searchParams.get('token');
}

async function verifiedUser (app, email = 'person@example.com') {
  const signup = await app.inject().post('/api/auth/sign-up/email')
    .headers({ origin: process.env.BASE_URL })
    .payload({ firstName: 'Test', lastName: 'Person', email, password });
  if (signup.statusCode !== 200) throw new Error(`Signup failed: ${signup.body}`);
  const token = await mailToken(nodemailerMock.mock);
  const verification = await app.inject(`/api/auth/verify-email?token=${token}`);
  if (verification.statusCode !== 200) throw new Error(`Verification failed: ${verification.statusCode}`);
  return { user: signup.json().user, headers: await authenticate(app, email, password) };
}

async function verifiedAdmin (app) {
  const email = 'admin.user@test.com';
  return {
    user: await app.prisma.user.findUnique({ where: { email } }),
    headers: await authenticate(app, email, 'test'),
  };
}

function sleep (ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function upload (fixtures) {
  return Promise.all(
    fixtures.map((f) => s3.putObject(path.join('_uploads', f[1]), path.resolve(__dirname, `fixtures/assets/${f[0]}`)))
  );
}

function assetExists (assetPath) {
  return s3.objectExists(assetPath);
}

export {
  assetExists,
  authenticate,
  authSecret,
  build,
  config,
  cookieHeaders,
  mailToken,
  nodemailerMock,
  password,
  upload,
  waitForMail,
  verifiedAdmin,
  verifiedUser,
};
