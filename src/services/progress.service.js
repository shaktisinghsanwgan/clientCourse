import { prisma } from '../config/database.js';
import { ApiError } from '../utils/errors.js';
import { normalizeEmail } from '../utils/security.js';
import {
  accessGranted,
  assertWeekNumber,
  buildWeekView,
  chapterPayload,
  chaptersForWeek,
  completedFlags,
  findPartnershipForUser,
  isCourseCompleted,
  loadChapterState,
  partnershipCurrentWeek,
  previousWeeksCompleted,
  progressForUser,
  syncMessage,
  TOTAL_WEEKS,
  weekActionMessage,
  weekSummaries,
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

function userWeeks(chapters, progress, userId, primaryFlags, partnerFlags, granted) {
  const rows = progressForUser(progress, userId);
  const weeks = [];
  for (let weekNumber = 1; weekNumber <= TOTAL_WEEKS; weekNumber += 1) {
    const weekChapters = chaptersForWeek(chapters, weekNumber);
    const unlocked = granted && previousWeeksCompleted(weekNumber, primaryFlags, partnerFlags);
    weeks.push(buildWeekView({
      weekNumber,
      chapters: weekChapters,
      userProgress: rows,
      unlocked,
    }));
  }
  return weeks;
}

export async function buildCourseSync(user) {
  const partnership = await findPartnershipForUser(user.id);
  const primaryUser = partnership?.primaryUser || (user.role === 'PRIMARY' ? user : null);
  const partnerUser = partnership?.partnerUser || null;
  const { chapters, progress } = await loadChapterState(
    prisma,
    partnership?.primaryUserId || user.id,
    partnership?.partnerUserId,
  );

  const primarySummaries = weekSummaries(chapters, progress, partnership?.primaryUserId || user.id);
  const partnerSummaries = weekSummaries(chapters, progress, partnership?.partnerUserId);
  const primaryFlags = completedFlags(primarySummaries);
  const partnerFlags = completedFlags(partnerSummaries);
  const granted = accessGranted(partnership, primaryUser, partnerUser);
  const courseCompleted = granted && isCourseCompleted(primaryFlags, partnerFlags);
  const currentWeek = granted ? partnershipCurrentWeek(primaryFlags, partnerFlags) : null;

  const viewerIsPrimary = !partnership || partnership.primaryUserId === user.id;
  const viewerSummaries = viewerIsPrimary ? primarySummaries : partnerSummaries;
  const otherSummaries = viewerIsPrimary ? partnerSummaries : primarySummaries;
  const viewerFlags = completedFlags(viewerSummaries);

  const viewerWeeks = userWeeks(
    chapters,
    progress,
    user.id,
    primaryFlags,
    partnerFlags,
    granted,
  );

  let partnerWeeks = [];
  if (partnerUser) {
    partnerWeeks = userWeeks(
      chapters,
      progress,
      partnerUser.id,
      primaryFlags,
      partnerFlags,
      granted,
    );
  }

  const viewerCurrent = currentWeek;
  const bothCompletedCurrentWeek = Boolean(
    currentWeek && primaryFlags[currentWeek] && partnerFlags[currentWeek],
  );
  const nextWeekUnlocked = Boolean(
    currentWeek && currentWeek < TOTAL_WEEKS && bothCompletedCurrentWeek,
  );

  return {
    success: true,
    course: {
      totalWeeks: TOTAL_WEEKS,
      currentWeek,
      courseCompleted,
    },
    user: {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      currentWeek: viewerCurrent,
      weeks: viewerWeeks,
    },
    partner: partnership
      ? {
        id: partnerUser && !viewerIsPrimary
          ? Number(primaryUser.id)
          : (partnerUser ? Number(partnerUser.id) : null),
        name: viewerIsPrimary
          ? (partnerUser?.name || partnership.partnerName)
          : primaryUser.name,
        email: viewerIsPrimary
          ? partnership.partnerEmail
          : primaryUser.email,
        currentWeek: viewerCurrent,
        weeks: viewerIsPrimary ? partnerWeeks : userWeeks(
          chapters,
          progress,
          primaryUser.id,
          primaryFlags,
          partnerFlags,
          granted,
        ),
      }
      : null,
    synchronization: {
      partnershipActive: granted,
      currentWeek,
      bothCompletedCurrentWeek,
      nextWeekUnlocked,
      nextAvailableWeek: nextWeekUnlocked ? currentWeek + 1 : null,
      message: syncMessage({
        partnership,
        primaryUser: primaryUser || user,
        partnerUser,
        courseCompleted,
        currentWeek: currentWeek || 1,
        userCompleted: Boolean(currentWeek && viewerFlags[currentWeek]),
        partnerCompleted: Boolean(currentWeek && (viewerIsPrimary ? partnerFlags[currentWeek] : primaryFlags[currentWeek])),
      }),
    },
  };
}

export async function getPartnerProgressByPurchaserEmail(emailInput) {
  const email = normalizeEmail(emailInput);
  const purchaser = await prisma.user.findUnique({ where: { email } });
  if (!purchaser || purchaser.role !== 'PRIMARY') {
    throw new ApiError(404, 'No partner found', 'PARTNER_NOT_FOUND');
  }

  const partner = await buildPartnerProgress(purchaser);
  return {
    purchaser: {
      id: Number(purchaser.id),
      email: purchaser.email,
    },
    partner,
  };
}

export async function buildPartnerProgress(user) {
  const sync = await buildCourseSync(user);
  if (!sync.partner) {
    throw new ApiError(404, 'No partner found', 'PARTNER_NOT_FOUND');
  }
  if (!sync.partner.id) {
    throw new ApiError(409, 'Partner not registered', 'PARTNER_NOT_REGISTERED');
  }
  return {
    id: sync.partner.id,
    name: sync.partner.name,
    email: sync.partner.email,
    currentWeek: sync.partner.currentWeek,
    weeks: sync.partner.weeks,
  };
}

export async function getMyProgress(user) {
  const sync = await buildCourseSync(user);
  return {
    id: sync.user.id,
    name: sync.user.name,
    email: sync.user.email,
    currentWeek: sync.user.currentWeek,
    weeks: sync.user.weeks,
    synchronization: sync.synchronization,
  };
}

export async function getWeekProgress(user, weekValue) {
  const weekNumber = assertWeekNumber(weekValue);
  const partnership = await findPartnershipForUser(user.id);
  if (!partnership) {
    throw new ApiError(404, 'No partner found', 'PARTNER_NOT_FOUND');
  }

  const { chapters, progress } = await loadChapterState(
    prisma,
    partnership.primaryUserId,
    partnership.partnerUserId,
  );
  const primarySummaries = weekSummaries(chapters, progress, partnership.primaryUserId);
  const partnerSummaries = weekSummaries(chapters, progress, partnership.partnerUserId);
  const primaryFlags = completedFlags(primarySummaries);
  const partnerFlags = completedFlags(partnerSummaries);
  const granted = accessGranted(partnership, partnership.primaryUser, partnership.partnerUser);
  const unlocked = granted && previousWeeksCompleted(weekNumber, primaryFlags, partnerFlags);
  const viewerIsPrimary = partnership.primaryUserId === user.id;
  const userSummary = viewerIsPrimary ? primarySummaries[weekNumber] : partnerSummaries[weekNumber];
  const partnerSummary = viewerIsPrimary ? partnerSummaries[weekNumber] : primarySummaries[weekNumber];
  const nextUnlocked = weekNumber < TOTAL_WEEKS
    && primarySummaries[weekNumber].completed
    && partnerSummaries[weekNumber].completed;

  const weekChapters = chaptersForWeek(chapters, weekNumber);
  return {
    weekNumber,
    unlocked,
    partnershipCompleted: primarySummaries[weekNumber].completed && partnerSummaries[weekNumber].completed,
    nextWeekUnlocked: nextUnlocked,
    message: weekActionMessage({
      weekNumber,
      userSummary,
      partnerSummary,
      nextUnlocked,
    }),
    user: {
      id: Number(user.id),
      name: user.name,
      ...publicSummary(userSummary),
      chapters: chapterPayload(weekChapters, progressForUser(progress, user.id)),
    },
    partner: {
      id: viewerIsPrimary
        ? (partnership.partnerUser ? Number(partnership.partnerUser.id) : null)
        : Number(partnership.primaryUser.id),
      name: viewerIsPrimary
        ? (partnership.partnerUser?.name || partnership.partnerName)
        : partnership.primaryUser.name,
      ...publicSummary(partnerSummary),
      chapters: chapterPayload(
        weekChapters,
        progressForUser(progress, viewerIsPrimary ? partnership.partnerUserId : partnership.primaryUserId),
      ),
    },
  };
}

