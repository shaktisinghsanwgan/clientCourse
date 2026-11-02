import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sendMissingPartnerInviteEmail } from './mail.service.js';

export async function notifyPartnerInviteShown(kajabiUserId, {
  send = sendMissingPartnerInviteEmail,
} = {}) {
  const id = String(kajabiUserId || '').trim();
  const user = id
    ? await prisma.user.findUnique({ where: { kajabiUserId: id } })
    : null;
  if (!user || user.status !== 'ACTIVE' || user.role !== 'PRIMARY') {
    return { status: 'skipped' };
  }

  const partnership = await prisma.partner.findUnique({ where: { primaryUserId: user.id } });
  if (partnership) {
    return { status: 'skipped', userId: Number(user.id) };
  }

  const existing = await prisma.partnerInviteNotice.findUnique({ where: { userId: user.id } });
  if (existing) {
    return { status: 'skipped', userId: Number(user.id) };
  }

  const recipientEmail = env.CLIENT_EMAIL;
  if (!recipientEmail) {
    return { status: 'unconfigured', userId: Number(user.id) };
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
    return { status: 'failed', userId: Number(user.id) };
  }

  if (!delivery?.delivered) {
    return {
      status: delivery?.skipped ? 'unconfigured' : 'failed',
      userId: Number(user.id),
    };
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
      return { status: 'skipped', userId: Number(user.id) };
    }
    throw error;
  }

  return { status: 'notified', userId: Number(user.id), recipientEmail };
}
