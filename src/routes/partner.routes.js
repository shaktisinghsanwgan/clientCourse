import { Router } from 'express';
import { authenticate, authenticateUserOrAdmin } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/errors.js';
import { validate } from '../middleware/validate.middleware.js';
import { linkPartnerSchema } from '../validators/partner.validator.js';
import * as partnerController from '../controllers/partner.controller.js';

const router = Router();

router.post('/link', authenticateUserOrAdmin, validate(linkPartnerSchema), asyncHandler(partnerController.link));
router.get('/me', authenticate, asyncHandler(partnerController.me));
router.get('/progress', authenticate, asyncHandler(partnerController.progress));

export default router;
