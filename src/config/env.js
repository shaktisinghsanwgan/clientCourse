import dotenv from 'dotenv';

if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test', override: true });
} else {
  dotenv.config();
}

function railwayMysqlUrl() {
  const provided = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || '';
  if (provided.trim()) {
    return provided.trim();
  }

  const host = process.env.MYSQLHOST;
  const user = process.env.MYSQLUSER;
  const password = process.env.MYSQLPASSWORD;
  const database = process.env.MYSQLDATABASE;
  const port = process.env.MYSQLPORT || '3306';
  if (!host || !user || password == null || password === '' || !database) {
    return '';
  }
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

const databaseUrl = (process.env.DATABASE_URL || '').trim() || railwayMysqlUrl();
if (databaseUrl) {
  const needsPool = process.env.NODE_ENV !== 'test'
    && databaseUrl.startsWith('mysql://')
    && !databaseUrl.includes('connection_limit=');
  process.env.DATABASE_URL = needsPool
    ? `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}connection_limit=5`
    : databaseUrl;
}

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
