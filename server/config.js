import { loadEnvFile } from 'node:process';

try {
  loadEnvFile(new URL('.env', import.meta.url));
} catch (error) {
  // Deployments can supply all configuration through the process environment.
  if (error.code !== 'ENOENT') throw error;
}
