import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { asId } from '../utils/security.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function inactivityThresholdMs(days = env.INACTIVITY_DAYS) {
  return days * DAY_MS;
}

export function isInactiveForWeek(lastActivityAt, now = new Date(), days = env.INACTIVITY_DAYS) {
  if (!lastActivityAt) return false;
  return now.getTime() - new Date(lastActivityAt).getTime() > inactivityThresholdMs(days);
}

export async function touchActivity(userId, at = new Date(), db = prisma) {
  return db.user.update({
    where: { id: asId(userId) },
    data: { lastActivityAt: at, lastSeenAt: at },
  });
}

export async function touchPresence(userId, at = new Date(), db = prisma) {
  return db.user.update({
    where: { id: asId(userId) },
    data: { lastSeenAt: at },
  });
}

function presence(user, now) {
  const lastActivityAt = new Date(user.lastActivityAt);
  const lastSeenAt = new Date(user.lastSeenAt);
  const activityElapsed = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const seenElapsed = Math.max(0, now.getTime() - lastSeenAt.getTime());
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    accountStatus: user.status,
    lastActivityAt: lastActivityAt.toISOString(),
    lastSeenAt: lastSeenAt.toISOString(),
    inactiveForWeek: isInactiveForWeek(lastActivityAt, now),
    inactiveDays: Math.floor(activityElapsed / DAY_MS),
    live: seenElapsed <= env.STATUS_LIVE_MINUTES * 60 * 1000,
    registered: true,
  };
}

function pendingPartner(partnership) {
  return {
    id: null,
    name: partnership.partnerName,
    email: partnership.partnerEmail,
    role: 'PARTNER',
    accountStatus: 'PENDING',
    lastActivityAt: null,
    lastSeenAt: null,
    inactiveForWeek: false,
    inactiveDays: null,
    live: false,
    registered: false,
  };
}

export async function syncLiveStatus(user) {
  const updated = await touchPresence(user.id);
  const now = new Date(updated.lastSeenAt);
  const partnership = await prisma.partner.findFirst({
    where: {
      OR: [{ primaryUserId: updated.id }, { partnerUserId: updated.id }],
    },
  });

  let partner = null;
  if (partnership) {
    const otherId = partnership.primaryUserId === updated.id
      ? partnership.partnerUserId
      : partnership.primaryUserId;
    if (otherId) {
      const other = await prisma.user.findUnique({ where: { id: otherId } });
      partner = other ? presence(other, now) : null;
    } else if (partnership.primaryUserId === updated.id) {
      partner = pendingPartner(partnership);
    }
  }

  return {
    syncedAt: now.toISOString(),
    inactivityThresholdDays: env.INACTIVITY_DAYS,
    user: presence(updated, now),
    partner,
  };
}
