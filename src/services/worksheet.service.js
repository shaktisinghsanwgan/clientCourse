import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/database.js';
import {
  PROGRAM_NAME,
  RATING_COPY,
  RATING_QUESTIONS,
  WEEK_COUNT,
  WEEKS,
  weekDefinition,
  worksheetDefinition,
} from '../data/worksheets.js';
import { ApiError } from '../utils/errors.js';
import { asId } from '../utils/security.js';
import {
  cleanFilename,
  isPdfUpload,
  removeStoredFiles,
  resolveStored,
  saveWorksheetFile,
  storedFileExists,
} from './worksheet-storage.service.js';

function roleName(role) {
  return role === 'PRIMARY' ? 'purchaser' : 'partner';
}

function ratingValues(input) {
  return {
    desireRating: input.desireRating ?? null,
    happinessRating: input.happinessRating ?? null,
    connectionRating: input.connectionRating ?? null,
  };
}

function ratingDto(row) {
  if (!row) return null;
  return {
    desireRating: row.desireRating,
    happinessRating: row.happinessRating,
    connectionRating: row.connectionRating,
    status: row.status === 'SUBMITTED' ? 'submitted' : 'draft',
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
  };
}

function weekSnapshot(weekNumber, rating, checks, files) {
  const definition = weekDefinition(weekNumber);
  const checklistItems = definition.items.filter((item) => item.kind === 'checklist');
  const checklistCompleted = checklistItems.length > 0 && checklistItems.every((item) => checks.has(item.key));
  const ratingsCompleted = rating?.status === 'SUBMITTED';
  const weekCompleted = Boolean(ratingsCompleted && checklistCompleted);
  const started = Boolean(rating) || checks.size > 0 || files.length > 0;
  let status = 'pending';
  if (weekCompleted) status = 'completed';
  else if (started) status = 'in_progress';
  return {
    ratingsCompleted,
    checklistCompleted,
    weekCompleted,
    status,
  };
}

async function loadParticipantRecords(userId) {
  const [ratings, files, checks] = await Promise.all([
    prisma.weeklyRating.findMany({ where: { userId } }),
    prisma.worksheetFile.findMany({ where: { userId, active: true }, orderBy: { uploadedAt: 'desc' } }),
    prisma.checklistCompletion.findMany({ where: { userId, completed: true } }),
  ]);
  return { ratings, files, checks };
}

async function syncProgress(userId, ratings, files, checks) {
  const ratingsByWeek = new Map(ratings.map((row) => [row.weekNumber, row]));
  const existing = await prisma.weeklyWorksheetProgress.findMany({ where: { userId } });
  const existingByWeek = new Map(existing.map((row) => [row.weekNumber, row]));
  const weeks = [];

  for (let weekNumber = 1; weekNumber <= WEEK_COUNT; weekNumber += 1) {
    const weekFiles = files.filter((file) => file.weekNumber === weekNumber);
    const weekChecks = new Set(
      checks.filter((row) => row.weekNumber === weekNumber).map((row) => row.itemKey),
    );
    const snapshot = weekSnapshot(weekNumber, ratingsByWeek.get(weekNumber), weekChecks, weekFiles);
    const current = existingByWeek.get(weekNumber);
    const completedAt = snapshot.weekCompleted
      ? current?.completedAt || new Date()
      : null;
    const stored = {
      ratingsCompleted: snapshot.ratingsCompleted,
      checklistCompleted: snapshot.checklistCompleted,
      weekCompleted: snapshot.weekCompleted,
      completedAt,
    };
    const changed = !current
      || current.ratingsCompleted !== stored.ratingsCompleted
      || current.checklistCompleted !== stored.checklistCompleted
      || current.weekCompleted !== stored.weekCompleted
      || Boolean(current.completedAt) !== Boolean(completedAt);
    if (changed) {
      await prisma.weeklyWorksheetProgress.upsert({
        where: { userId_weekNumber: { userId, weekNumber } },
        update: stored,
        create: { userId, weekNumber, ...stored },
      });
    }
    weeks.push({ weekNumber, ...snapshot, completedAt });
  }

  const completedWeeks = weeks.filter((week) => week.weekCompleted).length;
  const currentWeek = weeks.find((week) => !week.weekCompleted)?.weekNumber || WEEK_COUNT;
  return {
    completedWeeks,
    totalWeeks: WEEK_COUNT,
    percent: Math.round((completedWeeks / WEEK_COUNT) * 100),
    currentWeek,
    label: `Week ${currentWeek} of ${WEEK_COUNT}`,
    weeks,
  };
}

function fileDto(file) {
  if (!file) return null;
  return {
    id: Number(file.id),
    filename: file.originalFilename,
    uploadedAt: file.uploadedAt,
    sizeBytes: file.sizeBytes,
  };
}

export async function buildPortalState(user) {
  const { ratings, files, checks } = await loadParticipantRecords(user.id);
  const progress = await syncProgress(user.id, ratings, files, checks);
  const ratingsByWeek = new Map(ratings.map((row) => [row.weekNumber, row]));
  const progressByWeek = new Map(progress.weeks.map((week) => [week.weekNumber, week]));

  return {
    participant: {
      id: Number(user.id),
      name: user.name,
      role: roleName(user.role),
      programName: PROGRAM_NAME,
    },
    copy: RATING_COPY,
    questions: RATING_QUESTIONS,
    progress: {
      completedWeeks: progress.completedWeeks,
      totalWeeks: progress.totalWeeks,
      percent: progress.percent,
      currentWeek: progress.currentWeek,
      label: progress.label,
    },
    weeks: WEEKS.map((week) => {
      const saved = progressByWeek.get(week.weekNumber);
      const rating = ratingsByWeek.get(week.weekNumber);
      return {
        weekNumber: week.weekNumber,
        status: saved.status,
        ratingsCompleted: saved.ratingsCompleted,
        checklistCompleted: saved.checklistCompleted,
        weekCompleted: saved.weekCompleted,
        completedAt: saved.completedAt,
        rating: ratingDto(rating),
        items: week.items.map((item) => {
          const file = item.kind === 'pdf'
            ? files.find((row) => row.weekNumber === week.weekNumber && row.worksheetKey === item.key && row.active)
            : null;
          const completed = item.kind === 'checklist'
            && checks.some((row) => row.weekNumber === week.weekNumber && row.itemKey === item.key && row.completed);
          return {
            key: item.key,
            title: item.title,
            kind: item.kind,
            completed,
            file: fileDto(file),
          };
        }),
      };
    }),
  };
}

export async function weekState(user, weekNumber) {
  const state = await buildPortalState(user);
  const week = state.weeks.find((item) => item.weekNumber === Number(weekNumber));
  if (!week) throw new ApiError(404, 'Week not found', 'INVALID_WEEK');
  return {
    participant: state.participant,
    copy: state.copy,
    questions: state.questions,
    progress: state.progress,
    week,
  };
}

async function requireDraftWeek(userId, weekNumber) {
  if (!weekDefinition(weekNumber)) {
    throw new ApiError(400, 'Week must be between 1 and 8', 'INVALID_WEEK');
  }
  const existing = await prisma.weeklyRating.findUnique({
    where: { userId_weekNumber: { userId, weekNumber } },
  });
  if (existing?.status === 'SUBMITTED') {
    throw new ApiError(409, 'This week is already submitted. Edit it before changing the ratings.', 'RATING_ALREADY_SUBMITTED');
  }
  return existing;
}

async function rememberRevision(tx, rating) {
  await tx.weeklyRatingRevision.create({
    data: {
      ratingId: rating.id,
      desireRating: rating.desireRating,
      happinessRating: rating.happinessRating,
      connectionRating: rating.connectionRating,
      status: rating.status,
    },
  });
}

export async function saveRatingDraft(user, input) {
  const weekNumber = input.weekNumber;
  const values = ratingValues(input);
  if (Object.values(values).every((value) => value == null)) {
    throw new ApiError(400, 'Enter at least one rating before saving.', 'VALIDATION_ERROR');
  }
  const existing = await requireDraftWeek(user.id, weekNumber);
  if (existing) {
    await prisma.weeklyRating.update({
      where: { id: existing.id },
      data: values,
    });
  } else {
    await prisma.weeklyRating.create({
      data: { userId: user.id, weekNumber, status: 'DRAFT', ...values },
    });
  }
  return buildPortalState(user);
}

export async function submitWeekRating(user, input) {
  const weekNumber = input.weekNumber;
  if (!weekDefinition(weekNumber)) {
    throw new ApiError(400, 'Week must be between 1 and 8', 'INVALID_WEEK');
  }
  const values = ratingValues(input);
  const existing = await prisma.weeklyRating.findUnique({
    where: { userId_weekNumber: { userId: user.id, weekNumber } },
  });
  if (existing?.status === 'SUBMITTED' && !input.edit) {
    throw new ApiError(409, 'This week is already submitted.', 'RATING_ALREADY_SUBMITTED');
  }

  await prisma.$transaction(async (tx) => {
    if (existing?.status === 'SUBMITTED') await rememberRevision(tx, existing);
    if (!existing) {
      await tx.weeklyRating.create({
        data: {
          userId: user.id,
          weekNumber,
          ...values,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });
      return;
    }
    await tx.weeklyRating.update({
      where: { id: existing.id },
      data: { ...values, status: 'SUBMITTED', submittedAt: new Date() },
    });
  });

  return buildPortalState(user);
}

export async function saveChecklistItem(user, input) {
  const item = worksheetDefinition(input.weekNumber, input.itemKey);
  if (!item || item.kind !== 'checklist') {
    throw new ApiError(404, 'Checklist item not found', 'CHECKLIST_NOT_FOUND');
  }
  await prisma.checklistCompletion.upsert({
    where: {
      userId_weekNumber_itemKey: {
        userId: user.id,
        weekNumber: input.weekNumber,
        itemKey: input.itemKey,
      },
    },
    update: {
      completed: input.completed,
      completedAt: input.completed ? new Date() : null,
    },
    create: {
      userId: user.id,
      weekNumber: input.weekNumber,
      itemKey: input.itemKey,
      completed: input.completed,
      completedAt: input.completed ? new Date() : null,
    },
  });
  return buildPortalState(user);
}

export async function saveWorksheetUpload(user, input, file) {
  const item = worksheetDefinition(input.weekNumber, input.worksheetKey);
  if (!item || item.kind !== 'pdf') {
    throw new ApiError(404, 'Worksheet not found', 'WORKSHEET_NOT_FOUND');
  }
  if (!isPdfUpload(file)) {
    throw new ApiError(400, 'Only PDF worksheets can be uploaded.', 'FILE_TYPE');
  }

  const relativePath = await saveWorksheetFile({
    userId: user.id,
    weekNumber: input.weekNumber,
    worksheetKey: input.worksheetKey,
    buffer: file.buffer,
  });
  const previous = await prisma.worksheetFile.findMany({
    where: {
      userId: user.id,
      weekNumber: input.weekNumber,
      worksheetKey: input.worksheetKey,
      active: true,
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      if (previous.length > 0) {
        await tx.worksheetFile.updateMany({
          where: { id: { in: previous.map((row) => row.id) } },
          data: { active: false, deletedAt: new Date() },
        });
      }
      await tx.worksheetFile.create({
        data: {
          userId: user.id,
          weekNumber: input.weekNumber,
          worksheetKey: input.worksheetKey,
          originalFilename: cleanFilename(file.originalname),
          storagePath: relativePath,
          mimeType: 'application/pdf',
          sizeBytes: file.buffer.length,
          active: true,
        },
      });
    });
  } catch (error) {
    await removeStoredFiles([relativePath]);
    throw error;
  }

  await removeStoredFiles(previous.map((row) => row.storagePath));
  return buildPortalState(user);
}

export async function worksheetFileForParticipant(user, fileId) {
  const file = await prisma.worksheetFile.findFirst({
    where: { id: asId(fileId), userId: user.id, active: true },
  });
  if (!file || !(await storedFileExists(file.storagePath))) {
    throw new ApiError(404, 'Worksheet not found', 'WORKSHEET_NOT_FOUND');
  }
  return file;
}

export async function deleteWorksheetFile(user, fileId) {
  const file = await worksheetFileForParticipant(user, fileId);
  await prisma.worksheetFile.update({
    where: { id: file.id },
    data: { active: false, deletedAt: new Date() },
  });
  await removeStoredFiles([file.storagePath]);
  return buildPortalState(user);
}

export function sendWorksheetFile(res, file) {
  const full = resolveStored(file.storagePath);
  const filename = String(file.originalFilename || 'worksheet.pdf').replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  fs.createReadStream(full).pipe(res);
}

export async function purgeParticipantContent(tx, userIds) {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return [];
  const files = await tx.worksheetFile.findMany({
    where: { userId: { in: ids } },
    select: { storagePath: true },
  });
  const ratings = await tx.weeklyRating.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  if (ratings.length > 0) {
    await tx.weeklyRatingRevision.deleteMany({
      where: { ratingId: { in: ratings.map((row) => row.id) } },
    });
  }
  await tx.weeklyRating.deleteMany({ where: { userId: { in: ids } } });
  await tx.checklistCompletion.deleteMany({ where: { userId: { in: ids } } });
  await tx.weeklyWorksheetProgress.deleteMany({ where: { userId: { in: ids } } });
  await tx.worksheetFile.deleteMany({ where: { userId: { in: ids } } });
  await tx.portalAccess.deleteMany({ where: { userId: { in: ids } } });
  return files.map((file) => file.storagePath);
}

function participantSummary(user, access, progress) {
  if (!user) return null;
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: roleName(user.role),
    kajabiUserId: user.kajabiUserId || null,
    kajabiContactId: access?.kajabiContactId || null,
    portalUrl: access?.portalUrl || null,
    registered: true,
    progress,
  };
}

async function summaryForUser(user) {
  if (!user) return null;
  const access = await prisma.portalAccess.findUnique({ where: { userId: user.id } });
  const state = await buildPortalState(user);
  const ratings = await prisma.weeklyRating.findMany({
    where: { userId: user.id },
    include: { revisions: { orderBy: { createdAt: 'asc' } } },
    orderBy: { weekNumber: 'asc' },
  });
  return {
    profile: participantSummary(user, access, state.progress),
    ratings: ratings.map((row) => ({
      ...ratingDto(row),
      weekNumber: row.weekNumber,
      history: row.revisions.map((revision) => ({
        desireRating: revision.desireRating,
        happinessRating: revision.happinessRating,
        connectionRating: revision.connectionRating,
        status: revision.status === 'SUBMITTED' ? 'submitted' : 'draft',
        createdAt: revision.createdAt,
      })),
    })),
    weeks: state.weeks,
  };
}

async function partnershipFor(user) {
  return prisma.partner.findFirst({
    where: { OR: [{ primaryUserId: user.id }, { partnerUserId: user.id }] },
    include: { primaryUser: true, partnerUser: true },
  });
}

export async function listAdminParticipants() {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { id: 'asc' },
    include: { portalAccess: true },
  });
  const progress = await prisma.weeklyWorksheetProgress.findMany();
  return users.map((user) => {
    const weeks = progress.filter((row) => row.userId === user.id && row.weekCompleted).length;
    return {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      role: roleName(user.role),
      kajabiUserId: user.kajabiUserId || null,
      kajabiContactId: user.portalAccess?.kajabiContactId || null,
      portalUrl: user.portalAccess?.portalUrl || null,
      completedWeeks: weeks,
      percent: Math.round((weeks / WEEK_COUNT) * 100),
    };
  });
}

export async function adminParticipantDetail(participantId) {
  const user = await prisma.user.findUnique({ where: { id: asId(participantId) } });
  if (!user) throw new ApiError(404, 'Participant not found', 'IDENTITY_NOT_FOUND');
  const partnership = await partnershipFor(user);
  const purchaser = partnership?.primaryUser || (user.role === 'PRIMARY' ? user : null);
  const partner = partnership?.partnerUser || (user.role === 'PARTNER' ? user : null);
  const [purchaserSummary, partnerSummary] = await Promise.all([
    summaryForUser(purchaser),
    summaryForUser(partner),
  ]);
  return {
    programName: PROGRAM_NAME,
    invitation: partnership && !partnership.partnerUser
      ? { name: partnership.partnerName, email: partnership.partnerEmail, registered: false }
      : null,
    purchaser: purchaserSummary,
    partner: partnerSummary,
  };
}

export async function adminWorksheetFile(participantId, fileId) {
  const file = await prisma.worksheetFile.findFirst({
    where: { id: asId(fileId), userId: asId(participantId), active: true },
  });
  if (!file || !(await storedFileExists(file.storagePath))) {
    throw new ApiError(404, 'Worksheet not found', 'WORKSHEET_NOT_FOUND');
  }
  return file;
}

export function downloadName(file) {
  return path.basename(file.originalFilename || 'worksheet.pdf');
}
