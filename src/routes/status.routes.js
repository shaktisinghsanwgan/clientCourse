import { Router } from 'express';
import { authenticateUnlessPurchaserEmail } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { purchaserEmailQuerySchema } from '../validators/progress.validator.js';
import { asyncHandler } from '../utils/errors.js';
import * as statusController from '../controllers/status.controller.js';

const router = Router();

router.get('/sync', authenticateUnlessPurchaserEmail, validate(purchaserEmailQuerySchema), asyncHandler(statusController.syncStatus));
router.post('/sync', authenticateUnlessPurchaserEmail, validate(purchaserEmailQuerySchema), asyncHandler(statusController.syncStatus));

export default router;
