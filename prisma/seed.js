import '../src/config/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SAMPLE_COUNTS = [5, 4, 6, 5, 4, 6, 5, 4];

async function main() {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (databaseUrl.includes('_test')) {
    throw new Error('Refusing to seed a test database');
  }

  const existing = await prisma.courseChapter.count();
  if (existing > 0) {
    console.log('Chapters already exist. Seed skipped.');
    return;
  }

  const chapters = SAMPLE_COUNTS.flatMap((count, index) => {
    const weekNumber = index + 1;
    return Array.from({ length: count }, (_, chapterIndex) => ({
      weekNumber,
      chapterId: `week-${weekNumber}-chapter-${chapterIndex + 1}`,
      chapterName: `Week ${weekNumber} Chapter ${chapterIndex + 1}`,
      chapterOrder: chapterIndex + 1,
      isActive: true,
    }));
  });

  await prisma.courseChapter.createMany({ data: chapters });
  console.log(`Seeded ${chapters.length} sample chapters across 8 weeks.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
