import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sendMissingPartnerInviteEmail } from './mail.service.js';

const HOUR_MS = 60 * 60 * 1000;

function reminderMs(hours) {
  const value = Number(hours ?? env.PARTNER_INVITE_REMINDER_HOURS);
  const safe = Number.isFinite(value) && value > 0 ? value : 48;
  return safe * HOUR_MS;
}

function reminderDue(existing, now, hours) {
  if (!existing) return true;
  return now.getTime() - new Date(existing.sentAt).getTime() >= reminderMs(hours);
}

async function purchaserByIdentity({ kajabiUserId, purchaserEmail }) {
  const id = String(kajabiUserId || '').trim();
  if (id) {
    const byKajabi = await prisma.user.findUnique({ where: { kajabiUserId: id } });
    if (byKajabi) return byKajabi;
  }
  const email = String(purchaserEmail || '').trim().toLowerCase();
  if (!email) return null;
  return prisma.user.findUnique({ where: { email } });
}

async function remindPurchaser(user, { now, send, hours }) {
  if (!user || user.status !== 'ACTIVE' || user.role !== 'PRIMARY') {
    return { status: 'skipped', userId: user ? Number(user.id) : undefined };
  }

  const partnership = await prisma.partner.findUnique({ where: { primaryUserId: user.id } });
  if (partnership) {
    return { status: 'skipped', userId: Number(user.id) };
  }

  const existing = await prisma.partnerInviteNotice.findUnique({ where: { userId: user.id } });
  if (!reminderDue(existing, now, hours)) {
    return { status: 'skipped', userId: Number(user.id) };
  }

  const recipientEmail = env.CLIENT_EMAIL;
  if (!recipientEmail) {
    return { status: 'unconfigured', userId: Number(user.id) };
  }

  const reminderHours = Number(hours ?? env.PARTNER_INVITE_REMINDER_HOURS);
  let delivery;
  try {
    delivery = await send({
      to: recipientEmail,
      purchaser: {
        id: Number(user.id),
        name: user.name,
        email: user.email,
      },
      registeredAt: user.createdAt,
      reminderHours,
    });
  } catch (error) {
    console.error(`Partner invite email failed for user ${user.id}: ${error.message}`);
    return { status: 'failed', userId: Number(user.id) };
  }

  if (!delivery?.delivered) {
    return {
      status: delivery?.skipped ? 'unconfigured' : 'failed',
      userId: Number(user.id),
    };
  }

  try {
    await prisma.partnerInviteNotice.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        recipientEmail,
        sentAt: now,
      },
      update: {
        recipientEmail,
        sentAt: now,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { status: 'skipped', userId: Number(user.id) };
    }
    throw error;
  }

  return { status: 'notified', userId: Number(user.id), recipientEmail };
}

export async function notifyPartnerInviteShown(kajabiUserId, {
  send = sendMissingPartnerInviteEmail,
  now = new Date(),
  purchaserEmail = '',
  hours,
} = {}) {
  const user = await purchaserByIdentity({ kajabiUserId, purchaserEmail });
  if (!user) return { status: 'skipped' };
  return remindPurchaser(user, { now, send, hours });
}

export async function notifyMissingPartnerInvites({
  now = new Date(),
  send = sendMissingPartnerInviteEmail,
  hours,
} = {}) {
  const purchasers = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      role: 'PRIMARY',
      primaryPartnership: { is: null },
    },
  });
  const results = [];

  for (const user of purchasers) {
    results.push(await remindPurchaser(user, { now, send, hours }));
  }

  const summary = {
    checked: purchasers.length,
    notified: results.filter((item) => item.status === 'notified').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    unconfigured: results.filter((item) => item.status === 'unconfigured').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  };

  if (summary.unconfigured > 0) {
    console.warn('Partner invite emails were not sent because SMTP_HOST, SMTP_FROM, or CLIENT_EMAIL is not configured');
  }

  return summary;
}
