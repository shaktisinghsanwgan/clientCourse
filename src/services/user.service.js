import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { toPublicUser } from '../utils/response.js';
import { asId, normalizeEmail } from '../utils/security.js';
import { touchActivity } from './activity.service.js';
import {
  extractPurchaseWebhook,
  isKajabiApiConfigured,
  verifyPurchaseByEmail,
} from './kajabi.service.js';

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
}

async function assertKajabiIdAvailable(kajabiUserId, email) {
  if (!kajabiUserId) {
    return;
  }
  const owner = await prisma.user.findUnique({ where: { kajabiUserId } });
  if (owner && owner.email !== email) {
    throw new ApiError(409, 'Conflicting Kajabi identity', 'IDENTITY_CONFLICT');
  }
}

function verificationFields(verification, existing) {
  const fields = {
    paymentStatus: existing?.paymentStatus || 'PENDING',
  };
  if (existing?.kajabiUserId) fields.kajabiUserId = existing.kajabiUserId;
  if (existing?.purchaseReference) fields.purchaseReference = existing.purchaseReference;
  if (existing?.offerReference) fields.offerReference = existing.offerReference;
  if (existing?.paymentVerificationSource) fields.paymentVerificationSource = existing.paymentVerificationSource;
  if (existing?.paymentVerifiedAt) fields.paymentVerifiedAt = existing.paymentVerifiedAt;

  if (!verification.configured || !verification.customer) {
    return fields;
  }

  fields.kajabiUserId = verification.customer.id;
  if (verification.paid) {
    fields.paymentStatus = 'PAID';
    fields.purchaseReference = verification.purchaseId;
    fields.offerReference = verification.offerId;
    fields.paymentVerificationSource = 'kajabi_api';
    fields.paymentVerifiedAt = existing?.paymentVerifiedAt || new Date();
  }

  return fields;
}

export async function registerPurchaser(input) {
  const email = normalizeEmail(input.email);
  const verification = await verifyPurchaseByEmail(email, input.kajabiCustomerId);
  if (verification.configured && verification.customer) {
    await assertKajabiIdAvailable(verification.customer.id, email);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== 'PRIMARY') {
    throw new ApiError(409, 'Conflicting Kajabi identity', 'IDENTITY_CONFLICT');
  }

  const fields = verificationFields(verification, existing);

  const data = {
    name: input.name.trim(),
    email,
    role: 'PRIMARY',
    status: 'ACTIVE',
    emailVerified: true,
    lastActivityAt: new Date(),
    lastSeenAt: new Date(),
    ...fields,
  };

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data })
    : await prisma.user.create({ data });

  return {
    created: !existing,
    ...(await authPayload(user)),
    kajabi: {
      configured: verification.configured,
      linked: Boolean(user.kajabiUserId),
    },
  };
}

export async function syncAuthenticatedUser(user, input) {
  if (!isKajabiApiConfigured()) {
    throw new ApiError(
      503,
      'Kajabi API is not configured. Identity stays tied to this account email.',
      'KAJABI_API_NOT_CONFIGURED',
    );
  }

  const verification = await verifyPurchaseByEmail(user.email, input.kajabiCustomerId);
  if (!verification.customer) {
    throw new ApiError(404, 'Kajabi customer was not found for this email', 'IDENTITY_NOT_FOUND');
  }

  await assertKajabiIdAvailable(verification.customer.id, user.email);

  const data = {
    kajabiUserId: verification.customer.id,
    name: user.name,
    lastActivityAt: new Date(),
    lastSeenAt: new Date(),
  };

  if (user.role === 'PRIMARY' && verification.paid && user.paymentStatus !== 'PAID') {
    data.paymentStatus = 'PAID';
    data.purchaseReference = verification.purchaseId;
    data.offerReference = verification.offerId;
    data.paymentVerificationSource = 'kajabi_api';
    data.paymentVerifiedAt = new Date();
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
  });

  return {
    user: toPublicUser(updated),
    identity: {
      platform: 'kajabi',
      linked: true,
      kajabiUserId: updated.kajabiUserId,
    },
  };
}

async function authPayload(user) {
  const partnership = await prisma.partner.findFirst({
    where: {
      OR: [{ primaryUserId: user.id }, { partnerUserId: user.id }],
    },
  });

  return {
    token: signToken(user),
    user: toPublicUser(user),
    partnership: partnership
      ? {
        id: Number(partnership.id),
        status: partnership.status,
        primaryUserId: Number(partnership.primaryUserId),
        partnerUserId: partnership.partnerUserId ? Number(partnership.partnerUserId) : null,
      }
      : null,
  };
}

async function activateInvitedPartner(email) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, primary_user_id, partner_user_id, partner_name, status
      FROM partners
      WHERE partner_email = ${email}
      LIMIT 1
      FOR UPDATE
    `;
    const invitation = rows[0];
    if (!invitation) {
      return null;
    }
    if (invitation.partner_user_id) {
      return tx.user.findUnique({ where: { id: asId(invitation.partner_user_id) } });
    }

    const primary = await tx.user.findUnique({ where: { id: asId(invitation.primary_user_id) } });
    if (!primary || primary.email === email) {
      throw new ApiError(409, 'Conflicting partner relationship', 'DUPLICATE_PARTNER');
    }

    const user = await tx.user.create({
      data: {
        name: invitation.partner_name,
        email,
        role: 'PARTNER',
        paymentStatus: 'PENDING',
        status: 'ACTIVE',
        emailVerified: true,
        lastActivityAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    await tx.partner.update({
      where: { id: asId(invitation.id) },
      data: {
        partnerUserId: user.id,
        status: 'ACTIVE',
      },
    });

    return user;
  });
}

export async function getUserById(userId) {
  const user = await prisma.user.findUnique({ where: { id: asId(userId) } });
  if (!user || user.status !== 'ACTIVE') {
    throw new ApiError(404, 'User not found', 'IDENTITY_NOT_FOUND');
  }
  return user;
}

export async function verifyUserRole(userId) {
  const user = await getUserById(userId);
  return rolePayload(user);
}

export async function getUserByKajabiId(kajabiUserId) {
  const user = await prisma.user.findUnique({ where: { kajabiUserId } });
  if (!user || user.status !== 'ACTIVE') {
    throw new ApiError(404, 'User not found', 'IDENTITY_NOT_FOUND');
  }
  return user;
}

export async function verifyByKajabiUserId(kajabiUserId) {
  return rolePayload(await getUserByKajabiId(kajabiUserId));
}

function rolePayload(user) {
  return {
    userId: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    kajabiUserId: user.kajabiUserId,
    kind: user.role === 'PRIMARY' ? 'purchaser' : 'partner',
    isPurchaser: user.role === 'PRIMARY',
    isPartner: user.role === 'PARTNER',
  };
}

export async function bindKajabiIdentity(input) {
  const email = normalizeEmail(input.email);
  const name = input.name ? input.name.trim() : '';
  const kajabiUserId = input.kajabiUserId.trim();

  let existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const invitation = await prisma.partner.findUnique({ where: { partnerEmail: email } });
    if (!invitation) {
      throw new ApiError(404, 'Enter the email you use to sign in. We could not find that email.', 'EMAIL_NOT_FOUND');
    }
    await loginByEmail(email);
    existing = await prisma.user.findUnique({ where: { email } });
  }
  if (!existing || existing.status !== 'ACTIVE') {
    throw new ApiError(404, 'Enter the email you use to sign in. We could not find that email.', 'EMAIL_NOT_FOUND');
  }
  if (existing.kajabiUserId && existing.kajabiUserId !== kajabiUserId) {
    throw new ApiError(409, 'This email is already linked to a login.', 'EMAIL_ALREADY_LINKED');
  }

  const owner = await prisma.user.findUnique({ where: { kajabiUserId } });
  if (owner && owner.id !== existing.id) {
    throw new ApiError(409, 'This login is already linked to another email.', 'IDENTITY_CONFLICT');
  }

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      kajabiUserId,
      lastActivityAt: new Date(),
      lastSeenAt: new Date(),
      ...(name ? { name } : {}),
    },
  });
  if (name && updated.role === 'PARTNER') {
    await prisma.partner.updateMany({
      where: { partnerUserId: updated.id },
      data: { partnerName: name },
    });
  }

  return {
    ...(await authPayload(updated)),
    ...rolePayload(updated),
  };
}

export async function updateUserAccount(userId, input) {
  const user = await getUserById(userId);
  const data = {};
  if (input.name) {
    data.name = input.name.trim();
  }
  if (input.email) {
    const email = normalizeEmail(input.email);
    const owner = await prisma.user.findUnique({ where: { email } });
    if (owner && owner.id !== user.id) {
      throw new ApiError(409, 'That email already belongs to another user', 'IDENTITY_CONFLICT');
    }
    data.email = email;
  }
  if (!data.name && !data.email) {
    throw new ApiError(400, 'Name or email is required', 'VALIDATION_ERROR');
  }
  data.lastActivityAt = new Date();
  data.lastSeenAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.user.update({ where: { id: user.id }, data });
    if (saved.role === 'PARTNER') {
      await tx.partner.updateMany({
        where: { partnerUserId: saved.id },
        data: {
          ...(data.name ? { partnerName: data.name } : {}),
          ...(data.email ? { partnerEmail: data.email } : {}),
        },
      });
    }
    return saved;
  });

  return toPublicUser(updated);
}

export async function loginByEmail(emailInput) {
  const email = normalizeEmail(emailInput);
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    try {
      user = await activateInvitedPartner(email);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        user = await prisma.user.findUnique({ where: { email } });
      } else {
        throw error;
      }
    }
  }

  if (!user || user.status !== 'ACTIVE') {
    throw new ApiError(404, 'Account not found', 'IDENTITY_NOT_FOUND');
  }

  return authPayload(await touchActivity(user.id));
}

export async function applyVerifiedPurchaseWebhook(body) {
  if (!env.KAJABI_WEBHOOK_SECRET) {
    throw new ApiError(503, 'Kajabi webhook is not configured', 'KAJABI_WEBHOOK_NOT_CONFIGURED');
  }
  if (!isKajabiApiConfigured()) {
    throw new ApiError(
      503,
      'Kajabi API is not configured. The webhook was not treated as payment proof.',
      'KAJABI_API_NOT_CONFIGURED',
    );
  }

  const extracted = extractPurchaseWebhook(body);
  if (extracted.event !== 'purchase') {
    return { ignored: true, event: extracted.event || 'unknown' };
  }
  if (!extracted.email) {
    throw new ApiError(400, 'Kajabi purchase payload did not include a customer email', 'VALIDATION_ERROR');
  }

  const verification = await verifyPurchaseByEmail(extracted.email, extracted.customerId || undefined);
  if (!verification.paid || !verification.customer) {
    throw new ApiError(409, 'Purchase could not be verified with the Kajabi API', 'PURCHASE_NOT_VERIFIED');
  }

  await assertKajabiIdAvailable(verification.customer.id, extracted.email);
  const existing = await prisma.user.findUnique({ where: { email: extracted.email } });
  if (existing && existing.role !== 'PRIMARY') {
    throw new ApiError(409, 'Conflicting Kajabi identity', 'IDENTITY_CONFLICT');
  }

  const data = {
    name: verification.customer.name || extracted.name || existing?.name || 'Purchaser',
    email: extracted.email,
    role: 'PRIMARY',
    status: 'ACTIVE',
    kajabiUserId: verification.customer.id,
    paymentStatus: 'PAID',
    purchaseReference: verification.purchaseId,
    offerReference: verification.offerId,
    paymentVerificationSource: 'kajabi_api',
    paymentVerifiedAt: new Date(),
    lastActivityAt: new Date(),
    lastSeenAt: new Date(),
  };

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data })
    : await prisma.user.create({ data });

  return {
    ignored: false,
    user: toPublicUser(user),
  };
}

export function getProfile(user) {
  return toPublicUser(user);
}
