import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/config/database.js';
import { resetKajabiCache } from '../src/services/kajabi.service.js';

const TABLES = [
  'chapter_progress',
  'progress',
  'partners',
  'email_confirmations',
  'course_chapters',
  'users',
];

export async function resetDatabase() {
  const rows = await prisma.$queryRaw`SELECT DATABASE() AS db`;
  const databaseName = String(rows[0].db || '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refusing to reset non-test database ${databaseName}`);
  }

  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}

beforeEach(async () => {
  await resetDatabase();
  resetKajabiCache();
});

afterAll(async () => {
  await prisma.$disconnect();
});
