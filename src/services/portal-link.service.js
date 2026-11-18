import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { PROGRAM_KEY } from '../data/worksheets.js';
import { ApiError } from '../utils/errors.js';
import { savePortalUrlContact } from './kajabi-contact.service.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function tokenKey() {
  return crypto.createHash('sha256').update(env.JWT_SECRET).digest();
}

export function hashPortalToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function encryptPortalToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decryptPortalToken(payload) {
  try {
    const buffer = Buffer.from(String(payload || ''), 'base64url');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function expiresAtForNewLink() {
  if (!env.PORTAL_LINK_DAYS) return null;
  return new Date(Date.now() + env.PORTAL_LINK_DAYS * 24 * 60 * 60 * 1000);
}

export function publicBaseUrl(req) {
  if (env.APP_BASE_URL) return env.APP_BASE_URL;
  const forwarded = req.get('x-forwarded-proto');
  const proto = forwarded ? forwarded.split(',')[0].trim() : req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

export async function ensurePortalLink(user, baseUrl) {
  const normalizedBase = String(baseUrl || '').replace(/\/$/, '');
  let access = await prisma.portalAccess.findUnique({ where: { userId: user.id } });
  if (!access) {
    const token = crypto.randomBytes(32).toString('base64url');
    access = await prisma.portalAccess.create({
      data: {
        userId: user.id,
        programKey: PROGRAM_KEY,
        tokenHash: hashPortalToken(token),
        tokenEnc: encryptPortalToken(token),
        expiresAt: expiresAtForNewLink(),
      },
    });
  }

  const token = decryptPortalToken(access.tokenEnc);
  let portalUrl = access.portalUrl || '';
  if (normalizedBase && token) portalUrl = `${normalizedBase}/worksheets/${token}`;
  const urlChanged = Boolean(portalUrl && portalUrl !== access.portalUrl);
  if (urlChanged) {
    access = await prisma.portalAccess.update({
      where: { id: access.id },
      data: { portalUrl, kajabiSyncedAt: null },
    });
  }

  let kajabiUpdated = false;
  let kajabiError = '';
  if (normalizedBase && token && portalUrl && !access.kajabiSyncedAt) {
    try {
      const saved = await savePortalUrlContact({
        email: user.email,
        kajabiId: user.kajabiUserId || '',
        portalUrl,
      });
      access = await prisma.portalAccess.update({
        where: { id: access.id },
        data: {
          portalUrl,
          kajabiSyncedAt: new Date(),
          kajabiContactId: saved.contactId,
        },
      });
      kajabiUpdated = true;
    } catch (error) {
      kajabiError = error instanceof Error ? error.message : 'Kajabi update failed';
      console.error(`Portal URL was not saved to Kajabi for user ${user.id}: ${kajabiError}`);
    }
  }

  return {
    userId: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role === 'PRIMARY' ? 'purchaser' : 'partner',
    portalUrl: portalUrl || null,
    kajabiUpdated,
    kajabiError: kajabiError || null,
    kajabiContactId: access.kajabiContactId || null,
  };
}

export async function syncAllPortalLinks(baseUrl) {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { id: 'asc' },
  });
  const links = [];
  for (let index = 0; index < users.length; index += 1) {
    links.push(await ensurePortalLink(users[index], baseUrl));
  }
  return links;
}

export async function participantFromToken(token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) {
    throw new ApiError(404, 'This worksheet link is invalid or has expired.', 'PORTAL_LINK_INVALID');
  }
  const access = await prisma.portalAccess.findUnique({
    where: { tokenHash: hashPortalToken(token) },
    include: { user: true },
  });
  if (!access || access.user.status !== 'ACTIVE') {
    throw new ApiError(404, 'This worksheet link is invalid or has expired.', 'PORTAL_LINK_INVALID');
  }
  if (access.expiresAt && access.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(404, 'This worksheet link is invalid or has expired.', 'PORTAL_LINK_EXPIRED');
  }
  return access.user;
}
