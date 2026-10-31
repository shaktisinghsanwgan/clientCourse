import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { inactivityThresholdMs } from './activity.service.js';
import { sendInactivityEmail } from './mail.service.js';

export async function notifyInactiveUsers({
  now = new Date(),
  days = env.INACTIVITY_DAYS,
  send = sendInactivityEmail,
} = {}) {
  const cutoff = new Date(now.getTime() - inactivityThresholdMs(days));
  const inactive = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      lastActivityAt: { lt: cutoff },
    },
  });
  const results = [];

  for (const user of inactive) {
    const existing = await prisma.inactivityNotice.findUnique({
      where: {
        userId_lastActivityAt: {
          userId: user.id,
          lastActivityAt: user.lastActivityAt,
        },
      },
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
        inactiveUser: {
          id: Number(user.id),
          name: user.name,
          email: user.email,
        },
        inactiveSince: user.lastActivityAt,
        days,
      });
    } catch (error) {
      console.error(`Inactivity email failed for user ${user.id}: ${error.message}`);
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
      await prisma.inactivityNotice.create({
        data: {
          userId: user.id,
          recipientEmail,
          lastActivityAt: user.lastActivityAt,
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
    checked: inactive.length,
    notified: results.filter((item) => item.status === 'notified').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    unconfigured: results.filter((item) => item.status === 'unconfigured').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  };

  if (summary.unconfigured > 0) {
    console.warn('Inactivity emails were not sent because SMTP_HOST, SMTP_FROM, or CLIENT_EMAIL is not configured');
  }

  return summary;
}
