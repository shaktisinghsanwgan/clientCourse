import { Router } from 'express';
import { env } from '../config/env.js';
import { asyncHandler, ApiError } from '../utils/errors.js';
import { safeEqual } from '../utils/security.js';
import { sendSuccess } from '../utils/response.js';
import { applyVerifiedPurchaseWebhook } from '../services/user.service.js';
import { kajabiIntegrationStatus } from '../services/kajabi.service.js';

const router = Router();

router.get('/kajabi/status', (req, res) => {
  sendSuccess(res, 200, 'Kajabi integration status', kajabiIntegrationStatus());
});

router.post('/kajabi/webhook', asyncHandler(async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!env.KAJABI_WEBHOOK_SECRET) {
    throw new ApiError(503, 'Kajabi webhook is not configured', 'KAJABI_WEBHOOK_NOT_CONFIGURED');
  }
  if (!token || !safeEqual(token, env.KAJABI_WEBHOOK_SECRET)) {
    throw new ApiError(401, 'Unauthorized', 'UNAUTHORIZED');
  }

  const result = await applyVerifiedPurchaseWebhook(req.body);
  if (result.ignored) {
    sendSuccess(res, 200, 'Event ignored', result);
    return;
  }
  sendSuccess(res, 200, 'Purchase verified', result);
}));

export default router;
