import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sendMissingPartnerInviteEmail } from './mail.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function notifyMissingPartnerInvites({
  now = new Date(),
  send = sendMissingPartnerInviteEmail,
} = {}) {
  const cutoff = new Date(now.getTime() - DAY_MS);
  const purchasers = await prisma.user.findMany({
    where: {
      role: 'PRIMARY',
      status: 'ACTIVE',
      createdAt: { lt: cutoff },
      primaryPartnership: null,
    },
  });
  const results = [];

  for (const user of purchasers) {
    const existing = await prisma.partnerInviteNotice.findUnique({
      where: { userId: user.id },
    });
    if (existing) {
      results.push({ userId: Number(user.id), status: 'skipped' });
      continue;
    }

    const recipientEmail = env.CLIENT_EMAIL;
    if (!recipientEmail) {
      results.push({ userId: Number(user.id), status: 'unconfigured' });
      continue;
    }

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
      });
    } catch (error) {
      console.error(`Partner invite email failed for user ${user.id}: ${error.message}`);
      results.push({ userId: Number(user.id), status: 'failed' });
      continue;
    }

    if (!delivery?.delivered) {
      results.push({
        userId: Number(user.id),
        status: delivery?.skipped ? 'unconfigured' : 'failed',
      });
      continue;
    }

    try {
      await prisma.partnerInviteNotice.create({
        data: {
          userId: user.id,
          recipientEmail,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        results.push({ userId: Number(user.id), status: 'skipped' });
        continue;
      }
      throw error;
    }

    results.push({
      userId: Number(user.id),
      status: 'notified',
      recipientEmail,
    });
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
