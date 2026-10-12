import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ApiError } from '../utils/errors.js';
import { asId } from '../utils/security.js';

export const TOTAL_WEEKS = 8;

export function assertWeekNumber(value) {
  const weekNumber = Number(value);
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > TOTAL_WEEKS) {
    throw new ApiError(400, 'Invalid week number', 'INVALID_WEEK');
  }
  return weekNumber;
}

export function percentage(completed, total) {
  if (total <= 0) {
    return 0;
  }
  return Math.round((completed / total) * 10000) / 100;
}

export function summarizeActiveChapters(chapters, progressRows) {
  const active = chapters.filter((chapter) => chapter.isActive);
  const completedIds = new Set(
    progressRows.filter((row) => row.completed).map((row) => row.chapterId),
  );
  const completedChapters = active.filter((chapter) => completedIds.has(chapter.chapterId)).length;
  const totalChapters = active.length;
  const remainingChapters = Math.max(0, totalChapters - completedChapters);
  const progressPercentage = percentage(completedChapters, totalChapters);
  return {
    totalChapters,
    completedChapters,
    remainingChapters,
    progressPercentage,
    completed: totalChapters > 0 && completedChapters === totalChapters,
  };
}

export function previousWeeksCompleted(weekNumber, primaryCompleted, partnerCompleted) {
  if (weekNumber <= 1) {
    return true;
  }
  for (let week = 1; week < weekNumber; week += 1) {
    if (!primaryCompleted[week] || !partnerCompleted[week]) {
      return false;
    }
  }
  return true;
}

export function isCourseCompleted(primaryCompleted, partnerCompleted) {
  for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
    if (!primaryCompleted[week] || !partnerCompleted[week]) {
      return false;
    }
  }
  return true;
}

export function partnershipCurrentWeek(primaryCompleted, partnerCompleted) {
  for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
    if (!primaryCompleted[week] || !partnerCompleted[week]) {
      return week;
    }
  }
  return TOTAL_WEEKS;
}

export function isRetryableTransaction(error) {
  const text = `${error?.message || ''} ${error?.code || ''} ${error?.meta?.code || ''}`;
  return text.includes('Deadlock') || text.includes('1213') || error?.code === 'P2034';
}

export async function withDeadlockRetry(work) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isRetryableTransaction(error) || attempt === 3) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

function mapPartnership(row) {
  if (!row) {
    return null;
  }
  return {
    id: asId(row.id),
    primaryUserId: asId(row.primary_user_id),
    partnerUserId: row.partner_user_id == null ? null : asId(row.partner_user_id),
    partnerName: row.partner_name,
    partnerEmail: row.partner_email,
    status: row.status,
  };
}

export async function lockPartnershipForUser(tx, userId) {
  const rows = await tx.$queryRaw`
    SELECT id, primary_user_id, partner_user_id, partner_name, partner_email, status
    FROM partners
    WHERE primary_user_id = ${userId} OR partner_user_id = ${userId}
    LIMIT 1
    FOR UPDATE
  `;
  return mapPartnership(rows[0]);
}

export async function findPartnershipForUser(userId) {
  return prisma.partner.findFirst({
    where: {
      OR: [{ primaryUserId: userId }, { partnerUserId: userId }],
    },
    include: {
      primaryUser: true,
      partnerUser: true,
    },
  });
}

export function assertCourseAccess(partnership, primaryUser, partnerUser) {
  if (!partnership) {
    throw new ApiError(404, 'No partner found', 'PARTNER_NOT_FOUND');
  }
  if (partnership.status !== 'ACTIVE' || !partnership.partnerUserId || !partnerUser) {
    throw new ApiError(409, 'Partner not registered', 'PARTNER_NOT_REGISTERED');
  }
  if (primaryUser.status !== 'ACTIVE' || partnerUser.status !== 'ACTIVE') {
    throw new ApiError(403, 'User is not active', 'USER_INACTIVE');
  }
}

export async function loadChapterState(db, primaryUserId, partnerUserId) {
  const chapters = await db.courseChapter.findMany({
    orderBy: [{ weekNumber: 'asc' }, { chapterOrder: 'asc' }, { id: 'asc' }],
  });
  const userIds = [primaryUserId, partnerUserId].filter(Boolean);
  const progress = userIds.length
    ? await db.chapterProgress.findMany({ where: { userId: { in: userIds } } })
    : [];
  return { chapters, progress };
}

export function chaptersForWeek(chapters, weekNumber) {
  return chapters.filter((chapter) => chapter.weekNumber === weekNumber);
}

export function progressForUser(progress, userId) {
  if (!userId) {
    return [];
  }
  const id = String(userId);
  return progress.filter((row) => String(row.userId) === id);
}

export function weekSummaries(chapters, progress, userId) {
  const rows = progressForUser(progress, userId);
  const summaries = {};
  for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
    summaries[week] = summarizeActiveChapters(chaptersForWeek(chapters, week), rows);
  }
  return summaries;
}

export function completedFlags(summaries) {
  const flags = {};
  for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
    flags[week] = Boolean(summaries[week]?.completed);
  }
  return flags;
}

export function chapterPayload(chapters, progressRows) {
  return chapters
    .filter((chapter) => chapter.isActive)
    .map((chapter) => {
      const row = progressRows.find((item) => item.chapterId === chapter.chapterId);
      return {
        chapterId: chapter.chapterId,
        chapterName: chapter.chapterName,
        chapterOrder: chapter.chapterOrder,
        completed: Boolean(row?.completed),
        completedAt: row?.completed && row.completedAt ? row.completedAt.toISOString() : null,
      };
    });
}

export function buildWeekView({
  weekNumber,
  chapters,
  userProgress,
  unlocked,
}) {
  const summary = summarizeActiveChapters(chapters, userProgress);
  return {
    weekNumber,
    ...summary,
    unlocked,
    chapters: chapterPayload(chapters, userProgress),
  };
}

export async function persistUserWeek(tx, userId, weekNumber, summary) {
  const existing = await tx.progress.findUnique({
    where: { userId_weekNumber: { userId, weekNumber } },
  });
  let completedAt = null;
  if (summary.completed) {
    completedAt = existing?.completed && existing.completedAt ? existing.completedAt : new Date();
  }

  const data = {
    totalChapters: summary.totalChapters,
    completedChapters: summary.completedChapters,
    progressPercentage: new Prisma.Decimal(summary.progressPercentage.toFixed(2)),
    completed: summary.completed,
    completedAt,
  };

  return tx.progress.upsert({
    where: { userId_weekNumber: { userId, weekNumber } },
    create: { userId, weekNumber, ...data },
    update: data,
  });
}

export async function recalculateUsersForWeeks(tx, userIds, weekNumbers) {
  const uniqueUsers = [...new Set(userIds.filter(Boolean).map((id) => String(id)))].map((id) => asId(id));
  const weeks = [...new Set(weekNumbers)];
  if (uniqueUsers.length === 0 || weeks.length === 0) {
    return;
  }

  const chapters = await tx.courseChapter.findMany({
    where: { weekNumber: { in: weeks } },
  });
  const progress = await tx.chapterProgress.findMany({
    where: { userId: { in: uniqueUsers } },
  });

  for (const userId of uniqueUsers) {
    const rows = progressForUser(progress, userId);
    for (const weekNumber of weeks) {
      const summary = summarizeActiveChapters(chaptersForWeek(chapters, weekNumber), rows);
      await persistUserWeek(tx, userId, weekNumber, summary);
    }
  }
}

export async function recalculatePartnershipWeeks(tx, partnership, weekNumbers) {
  await recalculateUsersForWeeks(
    tx,
    [partnership.primaryUserId, partnership.partnerUserId],
    weekNumbers,
  );
}

export function accessGranted(partnership, primaryUser, partnerUser) {
  return Boolean(
    partnership
    && partnership.status === 'ACTIVE'
    && partnership.partnerUserId
    && partnerUser
    && primaryUser?.status === 'ACTIVE'
    && partnerUser.status === 'ACTIVE',
  );
}

export function syncMessage({
  partnership,
  primaryUser,
  partnerUser,
  courseCompleted,
  currentWeek,
  userCompleted,
  partnerCompleted,
}) {
  if (!partnership) {
    return 'No partner found.';
  }
  if (partnership.status !== 'ACTIVE' || !partnerUser) {
    return 'Partner not registered.';
  }
  if (courseCompleted) {
    return 'Both partners completed the course.';
  }
  if (userCompleted && !partnerCompleted) {
    return `Waiting for partner to complete Week ${currentWeek}.`;
  }
  if (!userCompleted && partnerCompleted) {
    return `Your partner is waiting for you to complete Week ${currentWeek}.`;
  }
  if (userCompleted && partnerCompleted && currentWeek < TOTAL_WEEKS) {
    return `Both partners completed Week ${currentWeek}. Week ${currentWeek + 1} is now unlocked.`;
  }
  return `Waiting for both partners to complete Week ${currentWeek}.`;
}

export function weekActionMessage({ weekNumber, userSummary, partnerSummary, nextUnlocked }) {
  if (userSummary.totalChapters === 0) {
    return 'No active chapters are configured for this week.';
  }
  if (weekNumber === TOTAL_WEEKS && userSummary.completed && partnerSummary.completed) {
    return 'Both partners completed the course.';
  }
  if (userSummary.completed && partnerSummary.completed && nextUnlocked) {
    return `Both partners completed Week ${weekNumber}. Week ${weekNumber + 1} is now unlocked.`;
  }
  if (userSummary.completed && !partnerSummary.completed) {
    const remaining = partnerSummary.remainingChapters;
    return `Waiting for partner to complete ${remaining} remaining chapter${remaining === 1 ? '' : 's'}.`;
  }
  if (!userSummary.completed && partnerSummary.completed) {
    const remaining = userSummary.remainingChapters;
    return `Your partner is waiting for you to complete ${remaining} remaining chapter${remaining === 1 ? '' : 's'}.`;
  }
  return `Waiting for both partners to complete Week ${weekNumber}.`;
}
