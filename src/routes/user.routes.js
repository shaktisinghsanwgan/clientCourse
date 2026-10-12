import { Router } from 'express';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/errors.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  loginSchema,
  registerSchema,
  syncUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from '../validators/user.validator.js';
import * as userController from '../controllers/user.controller.js';

const router = Router();

router.post('/register', authenticateAdmin, validate(registerSchema), asyncHandler(userController.register));
router.post('/sync', authenticate, validate(syncUserSchema), asyncHandler(userController.syncUser));
router.get('/me', authenticate, asyncHandler(userController.me));
router.post('/login', validate(loginSchema), asyncHandler(userController.login));
router.get('/:userId', validate(userIdParamSchema), asyncHandler(userController.verify));
router.patch('/:userId', validate(updateUserSchema), asyncHandler(userController.update));

export default router;
