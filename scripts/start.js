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
const FAILED_ACTIVITY = '20261028130000_user_activity_and_inactivity_notices';

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

async function withPrisma(work) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function usersTableExists() {
  return withPrisma(async (prisma) => {
    const rows = await prisma.$queryRaw`
      SELECT TABLE_NAME AS tableName
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'users'
    `;
    return rows.length > 0;
  });
}

async function columnExists(prisma, tableName, columnName) {
  const rows = await prisma.$queryRaw`
    SELECT COLUMN_NAME AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ${tableName}
      AND column_name = ${columnName}
  `;
  return rows.length > 0;
}

async function finishActivityMigration() {
  await withPrisma(async (prisma) => {
    if (!(await columnExists(prisma, 'users', 'last_activity_at'))) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE `users` ADD COLUMN `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
      );
    }
    if (!(await columnExists(prisma, 'users', 'last_seen_at'))) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE `users` ADD COLUMN `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
      );
    }

    const indexes = await prisma.$queryRaw`
      SELECT INDEX_NAME AS indexName
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND index_name = 'users_status_last_activity_at_idx'
    `;
    if (!indexes.length) {
      await prisma.$executeRawUnsafe(
        'CREATE INDEX `users_status_last_activity_at_idx` ON `users`(`status`, `last_activity_at`)',
      );
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`inactivity_notices\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT NOT NULL,
        \`recipient_email\` VARCHAR(255) NOT NULL,
        \`last_activity_at\` DATETIME(3) NOT NULL,
        \`sent_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE INDEX \`inactivity_notices_user_id_last_activity_at_key\`(\`user_id\`, \`last_activity_at\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    const foreignKeys = await prisma.$queryRaw`
      SELECT CONSTRAINT_NAME AS constraintName
      FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = 'inactivity_notices'
        AND constraint_name = 'inactivity_notices_user_id_fkey'
        AND constraint_type = 'FOREIGN KEY'
    `;
    if (!foreignKeys.length) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE `inactivity_notices` ADD CONSTRAINT `inactivity_notices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
      );
    }
  });
}

async function recoverFailedMigration(output) {
  if (output.includes(FAILED_INIT)) {
    const applied = await usersTableExists();
    const flag = applied ? '--applied' : '--rolled-back';
    console.log(
      applied
        ? 'Init migration is marked failed, but the users table already exists. Marking it applied and continuing.'
        : 'Init migration failed before the tables were created. Clearing that record and applying it again.',
    );
    await run('npx', ['prisma', 'migrate', 'resolve', flag, FAILED_INIT]);
    return;
  }

  if (output.includes(FAILED_ACTIVITY)) {
    console.log('Activity migration is marked failed because last_activity_at already exists. Finishing the missing pieces and marking it applied.');
    await finishActivityMigration();
    await run('npx', ['prisma', 'migrate', 'resolve', '--applied', FAILED_ACTIVITY]);
    return;
  }

  throw new Error('A failed migration is blocking deploy, and it is not one this start script can repair.');
}

async function deployMigrations() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await run('npx', ['prisma', 'migrate', 'deploy']);
      return;
    } catch (error) {
      const output = error.output || '';
      if (!output.includes('P3009') || attempt === 2) {
        throw error;
      }
      await recoverFailedMigration(output);
    }
  }
}

try {
  await deployMigrations();
  await run('node', ['src/server.js']);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
