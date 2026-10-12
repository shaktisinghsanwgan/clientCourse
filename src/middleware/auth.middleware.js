import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { asId } from '../utils/security.js';
import { authenticateAdmin } from './admin.middleware.js';

export { authenticateAdmin };

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new ApiError(401, 'Authentication required', 'UNAUTHENTICATED');
    }

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new ApiError(401, 'Authentication required', 'TOKEN_EXPIRED');
      }
      throw new ApiError(401, 'Authentication required', 'UNAUTHENTICATED');
    }

    const user = await prisma.user.findUnique({ where: { id: asId(payload.sub) } });
    if (!user || user.status !== 'ACTIVE') {
      throw new ApiError(401, 'Authentication required', 'UNAUTHENTICATED');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function authenticateUnlessPurchaserEmail(req, res, next) {
  const email = req.query.purchaserEmail;
  const userId = req.query.userId;
  if ((typeof email === 'string' && email.trim()) || (typeof userId === 'string' && userId.trim())) {
    return next();
  }
  return authenticate(req, res, next);
}

export async function authenticateUserOrAdmin(req, res, next) {
  if (req.headers['x-api-key']) {
    return authenticateAdmin(req, res, next);
  }
  return authenticate(req, res, next);
}
