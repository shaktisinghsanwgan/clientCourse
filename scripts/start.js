import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { ensureDatabaseUrl, redactMysqlUrl } from '../src/config/database-url.js';

dotenv.config();

const databaseUrl = ensureDatabaseUrl({ pool: false });
if (!databaseUrl) {
  console.error(`DATABASE_URL is not set, and no Railway MySQL variables were found.

On the API service in Railway, open Variables and add a reference to the MySQL service:

  DATABASE_URL=\${{MySQL.MYSQL_URL}}
  JWT_SECRET=<a long random string>

The service name inside \${{...}} must match the MySQL service name in this project.
Use the private MYSQL_URL, not MYSQL_PUBLIC_URL.
Then redeploy the API service.`);
  process.exit(1);
}

console.log(`Database ${redactMysqlUrl(databaseUrl)}`);

const FAILED_INIT = '20261012084004_init';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      const error = new Error(`${command} ${args.join(' ')} exited with ${code}`);
      error.output = output;
      reject(error);
    });
  });
}

async function usersTableExists() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT TABLE_NAME AS tableName
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'users'
    `;
    return rows.length > 0;
  } finally {
    await prisma.$disconnect();
  }
}

async function deployMigrations() {
  try {
    await run('npx', ['prisma', 'migrate', 'deploy']);
  } catch (error) {
    const output = error.output || '';
    if (!output.includes('P3009') || !output.includes(FAILED_INIT)) {
      throw error;
    }
    const applied = await usersTableExists();
    const flag = applied ? '--applied' : '--rolled-back';
    console.log(
      applied
        ? 'Init migration is marked failed, but the users table already exists. Marking it applied and continuing.'
        : 'Init migration failed before the tables were created. Clearing that record and applying it again.',
    );
    await run('npx', ['prisma', 'migrate', 'resolve', flag, FAILED_INIT]);
    await run('npx', ['prisma', 'migrate', 'deploy']);
  }
}

try {
  await deployMigrations();
  await run('node', ['src/server.js']);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
