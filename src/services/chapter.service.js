import { prisma } from '../config/database.js';
import { ApiError } from '../utils/errors.js';
import { getWeekProgress } from './progress.service.js';
import { getUserById, getUserByKajabiId } from './user.service.js';
import {
  assertCourseAccess,
  assertWeekNumber,
  chaptersForWeek,
  completedFlags,
  loadChapterState,
  lockPartnershipForUser,
  previousWeeksCompleted,
  progressForUser,
  recalculatePartnershipWeeks,
  recalculateUsersForWeeks,
  summarizeActiveChapters,
  TOTAL_WEEKS,
  weekActionMessage,
  weekSummaries,
  withDeadlockRetry,
} from './unlock.service.js';

function publicSummary(summary) {
  return {
    totalChapters: summary.totalChapters,
    completedChapters: summary.completedChapters,
    remainingChapters: summary.remainingChapters,
    progressPercentage: summary.progressPercentage,
    completed: summary.completed,
  };
}

function assertUniqueStructure(chapters) {
  const ids = new Set();
  const orders = new Set();
  chapters.forEach((chapter) => {
    if (ids.has(chapter.chapterId)) {
      throw new ApiError(409, 'Duplicate chapter id', 'DUPLICATE_CHAPTER');
    }
    const orderKey = `${chapter.weekNumber}:${chapter.chapterOrder}`;
    if (orders.has(orderKey)) {
      throw new ApiError(409, 'Duplicate chapter order', 'DUPLICATE_CHAPTER');
    }
    ids.add(chapter.chapterId);
    orders.add(orderKey);
    assertWeekNumber(chapter.weekNumber);
  });
}

async function assertStoredOrders(tx) {
  const chapters = await tx.courseChapter.findMany();
  const orders = new Set();
  chapters.forEach((chapter) => {
    const orderKey = `${chapter.weekNumber}:${chapter.chapterOrder}`;
    if (orders.has(orderKey)) {
      throw new ApiError(409, 'Duplicate chapter order', 'DUPLICATE_CHAPTER');
    }
    orders.add(orderKey);
  });
}

async function recalculateActivePartnerships(tx, weekNumbers) {
  const partnerships = await tx.partner.findMany({ where: { status: 'ACTIVE' } });
  for (const partnership of partnerships) {
    await recalculatePartnershipWeeks(tx, partnership, weekNumbers);
  }
}

function chapterData(input) {
  return {
    weekNumber: input.weekNumber,
    chapterId: input.chapterId,
    chapterName: input.chapterName,
    chapterOrder: input.chapterOrder,
    isActive: input.isActive ?? true,
  };
}

export function presentChapter(chapter) {
  return {
    chapterId: chapter.chapterId,
    weekNumber: chapter.weekNumber,
    chapterName: chapter.chapterName,
    chapterOrder: chapter.chapterOrder,
    isActive: chapter.isActive,
  };
}

export async function createChapter(input) {
  assertWeekNumber(input.weekNumber);
  const existing = await prisma.courseChapter.findUnique({ where: { chapterId: input.chapterId } });
  if (existing) {
    throw new ApiError(409, 'Duplicate chapter id', 'DUPLICATE_CHAPTER');
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.courseChapter.create({ data: chapterData(input) });
    await assertStoredOrders(tx);
    await recalculateActivePartnerships(tx, [created.weekNumber]);
    return presentChapter(created);
  });
}

export async function updateChapter(chapterId, input) {
  if (input.weekNumber !== undefined) {
    assertWeekNumber(input.weekNumber);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.courseChapter.findUnique({ where: { chapterId } });
    if (!existing) {
      throw new ApiError(404, 'Chapter not found', 'CHAPTER_NOT_FOUND');
    }

    const updated = await tx.courseChapter.update({
      where: { chapterId },
      data: {
        weekNumber: input.weekNumber ?? existing.weekNumber,
        chapterName: input.chapterName ?? existing.chapterName,
        chapterOrder: input.chapterOrder ?? existing.chapterOrder,
        isActive: input.isActive ?? existing.isActive,
      },
    });
    await assertStoredOrders(tx);
    await recalculateActivePartnerships(tx, [existing.weekNumber, updated.weekNumber]);
    return presentChapter(updated);
  });
}

export async function setChapterActive(chapterId, isActive) {
  return updateChapter(chapterId, { isActive });
}

export async function syncChapters(chapters) {
  assertUniqueStructure(chapters);
  const weeks = new Set(chapters.map((chapter) => chapter.weekNumber));

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.courseChapter.findMany({
      where: { chapterId: { in: chapters.map((chapter) => chapter.chapterId) } },
    });
    existing.forEach((chapter) => weeks.add(chapter.weekNumber));

    for (const chapter of chapters) {
      const data = chapterData(chapter);
      await tx.courseChapter.upsert({
        where: { chapterId: chapter.chapterId },
        create: data,
        update: data,
      });
    }

    await assertStoredOrders(tx);
    await recalculateActivePartnerships(tx, [...weeks]);
    return tx.courseChapter.count();
  });

  return {
    upserted: chapters.length,
    totalChapters: result,
    weeksRecalculated: [...weeks].sort((left, right) => left - right),
  };
}

export async function listWeekChapters(user, weekValue) {
  const weekNumber = assertWeekNumber(weekValue);
  const week = await getWeekProgress(user, weekNumber);
  if (!week.unlocked) {
    throw new ApiError(403, 'You cannot access this week yet', 'WEEK_LOCKED');
  }
  return {
    weekNumber,
    chapters: week.user.chapters,
  };
}

function chapterSlug(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'chapter';
}

async function resolveProgressChapter(item) {
  const chapterName = item.chapterName.trim();
  if (item.chapterId) {
    const byId = await prisma.courseChapter.findUnique({ where: { chapterId: item.chapterId } });
    if (byId) return byId;
  }

  if (item.weekNumber) {
    const weekNumber = assertWeekNumber(item.weekNumber);
    const byName = await prisma.courseChapter.findFirst({
      where: { chapterName, weekNumber, isActive: true },
    });
    if (byName) return byName;

    const rows = await prisma.courseChapter.findMany({
      where: { weekNumber },
      select: { chapterOrder: true },
    });
    const chapterOrder = rows.reduce((max, row) => Math.max(max, row.chapterOrder), 0) + 1;
    const chapterId = String(item.chapterId || `week-${weekNumber}-${chapterSlug(chapterName)}`).slice(0, 100);
    return prisma.courseChapter.create({
      data: {
        weekNumber,
        chapterId,
        chapterName,
        chapterOrder,
        isActive: true,
      },
    });
  }

  const matches = await prisma.courseChapter.findMany({
    where: { chapterName, isActive: true },
  });
  if (matches.length === 0) {
    throw new ApiError(404, `Chapter not found: ${chapterName}`, 'CHAPTER_NOT_FOUND');
  }
  if (matches.length > 1) {
    throw new ApiError(409, `More than one chapter is named ${chapterName}`, 'CHAPTER_NOT_FOUND');
  }
  return matches[0];
}

export async function updateProgressByChapterNames(identity, chapters) {
  const user = identity.kajabiUserId
    ? await getUserByKajabiId(identity.kajabiUserId)
    : await getUserById(identity.userId);
  const updates = [];
  for (const item of chapters) {
    const chapter = await resolveProgressChapter(item);
    updates.push(await completeChapter(user, chapter.chapterId, item.completed !== false));
  }
  return {
    userId: Number(user.id),
    updates,
  };
}

export async function completeChapter(user, chapterId, completed) {
  return withDeadlockRetry(() => prisma.$transaction(async (tx) => {
    const partnership = await lockPartnershipForUser(tx, user.id);
    const primaryUser = partnership
      ? await tx.user.findUnique({ where: { id: partnership.primaryUserId } })
      : null;
    const partnerUser = partnership?.partnerUserId
      ? await tx.user.findUnique({ where: { id: partnership.partnerUserId } })
      : null;
    assertCourseAccess(partnership, primaryUser, partnerUser);

    const chapter = await tx.courseChapter.findUnique({ where: { chapterId } });
    if (!chapter) {
      throw new ApiError(404, 'Chapter not found', 'CHAPTER_NOT_FOUND');
    }
    if (!chapter.isActive) {
      throw new ApiError(409, 'Inactive chapters do not count toward completion', 'CHAPTER_INACTIVE');
    }

    const before = await loadChapterState(tx, partnership.primaryUserId, partnership.partnerUserId);
    const primaryFlags = completedFlags(weekSummaries(before.chapters, before.progress, partnership.primaryUserId));
    const partnerFlags = completedFlags(weekSummaries(before.chapters, before.progress, partnership.partnerUserId));
    if (!previousWeeksCompleted(chapter.weekNumber, primaryFlags, partnerFlags)) {
      throw new ApiError(403, 'You cannot access this week yet', 'WEEK_LOCKED');
    }

    const existing = await tx.chapterProgress.findUnique({
      where: { userId_chapterId: { userId: user.id, chapterId } },
    });
    if (!existing || existing.completed !== completed) {
      await tx.chapterProgress.upsert({
        where: { userId_chapterId: { userId: user.id, chapterId } },
        create: {
          userId: user.id,
          chapterId,
          completed,
          completedAt: completed ? new Date() : null,
        },
        update: {
          completed,
          completedAt: completed ? new Date() : null,
        },
      });
    }

    await recalculateUsersForWeeks(tx, [partnership.primaryUserId, partnership.partnerUserId], [chapter.weekNumber]);

    const refreshed = await loadChapterState(tx, partnership.primaryUserId, partnership.partnerUserId);
    const weekChapters = chaptersForWeek(refreshed.chapters, chapter.weekNumber);
    const partnerId = partnership.primaryUserId === user.id
      ? partnership.partnerUserId
      : partnership.primaryUserId;
    const userSummary = summarizeActiveChapters(weekChapters, progressForUser(refreshed.progress, user.id));
    const partnerSummary = summarizeActiveChapters(weekChapters, progressForUser(refreshed.progress, partnerId));
    const nextUnlocked = chapter.weekNumber < TOTAL_WEEKS && userSummary.completed && partnerSummary.completed;
    const partnerRecord = partnership.primaryUserId === user.id ? partnerUser : primaryUser;

    return {
      weekNumber: chapter.weekNumber,
      user: {
        id: Number(user.id),
        name: user.name,
        ...publicSummary(userSummary),
      },
      partner: {
        id: Number(partnerRecord.id),
        name: partnerRecord.name,
        ...publicSummary(partnerSummary),
      },
      partnership: {
        weekCompleted: userSummary.completed && partnerSummary.completed,
        nextWeekUnlocked: nextUnlocked,
        courseCompleted: chapter.weekNumber === TOTAL_WEEKS && userSummary.completed && partnerSummary.completed,
        message: weekActionMessage({
          weekNumber: chapter.weekNumber,
          userSummary,
          partnerSummary,
          nextUnlocked,
        }),
      },
    };
  }, { timeout: 20000 }));
}
