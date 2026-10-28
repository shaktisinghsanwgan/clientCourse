import { prisma } from '../config/database.js';
import { ApiError } from '../utils/errors.js';
import { sendSuccess } from '../utils/response.js';
import { normalizeEmail } from '../utils/security.js';
import { syncLiveStatus } from '../services/activity.service.js';
import { getUserById, getUserByKajabiId } from '../services/user.service.js';

async function resolveStatusUser(req) {
  const purchaserEmail = req.valid?.query?.purchaserEmail;
  const userId = req.valid?.query?.userId;
  const kajabiUserId = req.valid?.query?.kajabiUserId;

  if (userId) return getUserById(userId);
  if (kajabiUserId) return getUserByKajabiId(kajabiUserId);
  if (purchaserEmail) {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(purchaserEmail) } });
    if (!user || user.status !== 'ACTIVE') {
      throw new ApiError(404, 'User not found', 'IDENTITY_NOT_FOUND');
    }
    return user;
  }
  if (req.user) return req.user;
  throw new ApiError(401, 'Authentication required', 'UNAUTHENTICATED');
}

export async function syncStatus(req, res) {
  const user = await resolveStatusUser(req);
  const result = await syncLiveStatus(user);
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, 200, 'Live status', result);
}
