import { Router } from 'express';
import { authenticate, authenticateUnlessPurchaserEmail } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/errors.js';
import { validate } from '../middleware/validate.middleware.js';
import { purchaserEmailQuerySchema, weekParamSchema } from '../validators/progress.validator.js';
import * as progressController from '../controllers/progress.controller.js';

const router = Router();

router.get('/me', authenticate, asyncHandler(progressController.me));
router.get('/partner', authenticateUnlessPurchaserEmail, validate(purchaserEmailQuerySchema), asyncHandler(progressController.partner));
router.get('/week/:weekNumber', authenticate, validate(weekParamSchema), asyncHandler(progressController.week));

export default router;
