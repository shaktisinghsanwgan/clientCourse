import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { safeEqual } from '../utils/security.js';

export function authenticateAdmin(req, res, next) {
  const provided = req.headers['x-api-key'];
  const expected = env.ADMIN_API_KEY;
  if (!expected || typeof provided !== 'string' || !safeEqual(provided, expected)) {
    return next(new ApiError(401, 'Unauthorized', 'UNAUTHORIZED'));
  }
  req.admin = true;
  return next();
}
