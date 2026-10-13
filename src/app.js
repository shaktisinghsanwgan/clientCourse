import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './config/database.js';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { asyncHandler } from './utils/errors.js';
import userRoutes from './routes/user.routes.js';
import partnerRoutes from './routes/partner.routes.js';
import courseRoutes from './routes/course.routes.js';
import chapterRoutes from './routes/chapter.routes.js';
import progressRoutes from './routes/progress.routes.js';
import integrationRoutes from './routes/integration.routes.js';

export const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
}));

app.use(express.json({ limit: '100kb' }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests',
      errorCode: 'RATE_LIMITED',
    });
  },
}));

app.get('/api/v1/health', asyncHandler(async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      message: 'OK',
      data: { status: 'ok', database: 'up' },
    });
  } catch {
    res.status(503).json({
      success: false,
      message: 'Database unavailable',
      errorCode: 'DATABASE_UNAVAILABLE',
    });
  }
}));

app.use('/api/v1/users', userRoutes);
app.use('/api/v1/partners', partnerRoutes);
app.use('/api/v1/course', courseRoutes);
app.use('/api/v1/chapters', chapterRoutes);
app.use('/api/v1/progress', progressRoutes);
app.use('/api/v1/integrations', integrationRoutes);

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
app.use(express.static(publicDir));

app.use(notFoundHandler);
app.use(errorHandler);
