import { prisma } from '../config/database.js';
import { ApiError } from '../utils/errors.js';
import { asId, normalizeEmail } from '../utils/security.js';
import { buildCourseSync, buildPartnerProgress } from './progress.service.js';

async function resolvePrimaryUser(actor, input) {
  if (input.purchaserUserId) {
    const purchaser = await prisma.user.findUnique({ where: { id: asId(input.purchaserUserId) } });
    if (!purchaser || purchaser.role !== 'PRIMARY') {
      throw new ApiError(404, 'Primary purchaser was not found', 'IDENTITY_NOT_FOUND');
    }
    if (actor && actor.id !== purchaser.id) {
      throw new ApiError(403, 'Only the primary purchaser can link a partner', 'PRIMARY_ONLY');
    }
    return purchaser;
  }

  if (actor) {
    if (actor.role !== 'PRIMARY') {
      throw new ApiError(403, 'Only the primary purchaser can link a partner', 'PRIMARY_ONLY');
    }
    return actor;
  }

  if (!input.purchaserEmail) {
    throw new ApiError(400, 'Purchaser email is required', 'VALIDATION_ERROR');
  }

  const purchaser = await prisma.user.findUnique({
    where: { email: normalizeEmail(input.purchaserEmail) },
  });
  if (!purchaser || purchaser.role !== 'PRIMARY') {
    throw new ApiError(404, 'Primary purchaser was not found', 'IDENTITY_NOT_FOUND');
  }
  return purchaser;
}

export async function linkPartner(actor, input) {
  const primary = await resolvePrimaryUser(actor, input);
  const partnerEmail = normalizeEmail(input.partnerEmail);
  const partnerName = input.partnerName.trim();

  if (partnerEmail === primary.email) {
    throw new ApiError(409, 'You cannot invite yourself as a partner', 'SELF_PARTNER');
  }

  const existingUser = await prisma.user.findUnique({ where: { email: partnerEmail } });
  if (existingUser?.role === 'PRIMARY') {
    throw new ApiError(409, 'That email already belongs to a purchaser', 'DUPLICATE_PARTNER');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${primary.id} FOR UPDATE`;

    const current = await tx.partner.findUnique({ where: { primaryUserId: primary.id } });
    const emailOwner = await tx.partner.findUnique({ where: { partnerEmail } });

    if (emailOwner && emailOwner.primaryUserId !== primary.id) {
      throw new ApiError(409, 'That partner is already linked to another purchaser', 'DUPLICATE_PARTNER');
    }

    if (existingUser) {
      const linkedElsewhere = await tx.partner.findFirst({
        where: {
          partnerUserId: existingUser.id,
          NOT: { primaryUserId: primary.id },
        },
      });
      if (linkedElsewhere) {
        throw new ApiError(409, 'That partner is already linked to another purchaser', 'DUPLICATE_PARTNER');
      }
    }

    if (current?.status === 'ACTIVE') {
      if (current.partnerEmail === partnerEmail) {
        return presentPartnership(current, primary);
      }
      throw new ApiError(409, 'This purchaser already has an active partner', 'DUPLICATE_PARTNER');
    }

    if (current) {
      const updated = await tx.partner.update({
        where: { id: current.id },
        data: { partnerName, partnerEmail, status: 'PENDING', partnerUserId: null },
      });
      return presentPartnership(updated, primary);
    }

    const created = await tx.partner.create({
      data: {
        primaryUserId: primary.id,
        partnerName,
        partnerEmail,
        status: 'PENDING',
      },
    });
    return presentPartnership(created, primary);
  });
}

function presentPartnership(partnership, primary) {
  return {
    id: Number(partnership.id),
    status: partnership.status,
    partnerName: partnership.partnerName,
    partnerEmail: partnership.partnerEmail,
    partnerUserId: partnership.partnerUserId ? Number(partnership.partnerUserId) : null,
    primaryUser: {
      id: Number(primary.id),
      name: primary.name,
      email: primary.email,
    },
  };
}

export async function getMyPartnership(user) {
  const partnership = await prisma.partner.findFirst({
    where: {
      OR: [{ primaryUserId: user.id }, { partnerUserId: user.id }],
    },
    include: {
      primaryUser: true,
      partnerUser: true,
    },
  });

  if (!partnership) {
    throw new ApiError(404, 'No partner found', 'PARTNER_NOT_FOUND');
  }

  const partnerAccount = partnership.partnerUser;
  return {
    userId: Number(user.id),
    status: partnership.status,
    partner: {
      id: partnerAccount ? Number(partnerAccount.id) : null,
      name: partnerAccount?.name || partnership.partnerName,
      email: partnership.partnerEmail,
    },
  };
}

export async function getPartnerProgress(user) {
  const partnership = await getMyPartnership(user);
  if (!partnership.partner.id) {
    throw new ApiError(409, 'Partner not registered', 'PARTNER_NOT_REGISTERED');
  }
  return buildPartnerProgress(user);
}

export async function getMyCourseSync(user) {
  return buildCourseSync(user);
}
