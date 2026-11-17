import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export async function setupDevEnv (root = fileURLToPath(new URL('../', import.meta.url)), { nodeEnv = process.env.NODE_ENV } = {}) {
  if (nodeEnv === 'production') throw new Error('Development environment setup must not run in production. Configure BETTER_AUTH_SECRET explicitly.');
  const serverEnv = path.join(root, 'server/.env');
  let contents;
  try {
    contents = await readFile(serverEnv, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    contents = await readFile(path.join(root, 'server/example.env'), 'utf8');
  }
  const config = parse(contents);
  if (config.NODE_ENV === 'production') throw new Error('Development environment setup must not run with a production env file.');
  const secret = config.BETTER_AUTH_SECRET;
  const generatedSecret = !secret || secret.length < 32 || secret.startsWith('replace-with-');
  if (generatedSecret) {
    const assignment = `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64')}\n`;
    const pattern = /^(?:export\s+)?BETTER_AUTH_SECRET\s*=.*(?:\r?\n|$)/gm;
    contents = pattern.test(contents) ? contents.replace(pattern, () => assignment) : `${contents.replace(/\s*$/, '')}\n${assignment}`;
  }
  await writeFile(serverEnv, contents, { mode: 0o600 });
  await chmod(serverEnv, 0o600);
  // Only browser-visible configuration belongs in the client env file.
  const clientEnv = Object.entries(parse(contents))
    .filter(([key]) => key.startsWith('VITE_'))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n');
  await writeFile(path.join(root, 'client/.env'), `${clientEnv}\n`);
  return { generatedSecret };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { generatedSecret } = await setupDevEnv();
  console.log(generatedSecret ? 'Development environment ready; generated a persistent local auth secret.' : 'Development environment ready.');
}
