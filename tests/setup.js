import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/config/database.js';
import { resetKajabiCache } from '../src/services/kajabi.service.js';
import { resetKajabiContactCache } from '../src/services/kajabi-contact.service.js';

const TABLES = [
  'weekly_rating_revisions',
  'weekly_ratings',
  'worksheet_files',
  'checklist_completions',
  'weekly_worksheet_progress',
  'portal_access',
  'chapter_progress',
  'progress',
  'partners',
  'inactivity_notices',
  'partner_invite_notices',
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
  resetKajabiContactCache();
});

afterAll(async () => {
  await prisma.$disconnect();
});
