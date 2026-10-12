import dotenv from 'dotenv';
import { ensureDatabaseUrl } from './database-url.js';

if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test', override: true });
} else {
  dotenv.config();
}

ensureDatabaseUrl();

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function optional(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : '';
}

if (process.env.NODE_ENV !== 'test') {
  required('DATABASE_URL');
  required('JWT_SECRET');
}

if (optional('DATABASE_URL') && !optional('DATABASE_URL').startsWith('mysql://') && !optional('DATABASE_URL').startsWith('mysqls://')) {
  throw new Error('DATABASE_URL must be a MySQL connection string');
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 5000),
  get DATABASE_URL() {
    return optional('DATABASE_URL');
  },
  get JWT_SECRET() {
    return optional('JWT_SECRET');
  },
  get JWT_EXPIRES_IN() {
    return optional('JWT_EXPIRES_IN') || '7d';
  },
  get FRONTEND_URL() {
    return optional('FRONTEND_URL') || 'http://localhost:3000';
  },
  get KAJABI_API_BASE_URL() {
    return optional('KAJABI_API_BASE_URL').replace(/\/$/, '');
  },
  get KAJABI_API_KEY() {
    return optional('KAJABI_API_KEY');
  },
  get KAJABI_API_SECRET() {
    return optional('KAJABI_API_SECRET');
  },
  get KAJABI_SITE_ID() {
    return optional('KAJABI_SITE_ID');
  },
  get KAJABI_OFFER_ID() {
    return optional('KAJABI_OFFER_ID');
  },
  get KAJABI_WEBHOOK_SECRET() {
    return optional('KAJABI_WEBHOOK_SECRET');
  },
  get ADMIN_API_KEY() {
    return optional('ADMIN_API_KEY');
  },
};
