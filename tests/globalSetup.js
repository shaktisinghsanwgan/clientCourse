import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test', override: true });
process.env.NODE_ENV = 'test';

const testUrl = process.env.DATABASE_URL || '';
if (!testUrl.includes('_test')) {
  throw new Error('Refusing to migrate because DATABASE_URL does not point at a _test database');
}

const url = new URL(testUrl);
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const sql = `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;

const created = spawnSync('docker', [
  'compose', 'exec', '-T', 'mysql',
  'mysql', `-u${user}`, `-p${password}`,
  '-e', sql,
], { stdio: 'inherit' });

if (created.status !== 0) {
  throw new Error('Could not create the test database. Start MySQL with docker compose up -d.');
}

const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: testUrl, NODE_ENV: 'test' },
});

if (migrated.status !== 0) {
  throw new Error('prisma migrate deploy failed for the test database');
}

export default async function setup() {
  return undefined;
}
