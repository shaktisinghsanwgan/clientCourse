function usableMysqlUrl(value) {
  const url = (value || '').trim();
  return url.startsWith('mysql://') ? url : '';
}

export function mysqlUrlFromEnv() {
  const direct = usableMysqlUrl(process.env.DATABASE_URL)
    || usableMysqlUrl(process.env.MYSQL_URL)
    || usableMysqlUrl(process.env.MYSQL_PUBLIC_URL);
  if (direct) {
    return direct;
  }

  const host = process.env.MYSQLHOST || process.env.MYSQL_HOST;
  const user = process.env.MYSQLUSER || process.env.MYSQL_USER;
  const password = process.env.MYSQLPASSWORD ?? process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE;
  const port = process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306';
  if (!host || !user || password == null || password === '' || !database) {
    return '';
  }
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function ensureDatabaseUrl({ pool = true } = {}) {
  const url = mysqlUrlFromEnv();
  if (!url) {
    return '';
  }
  const withPool = pool
    && process.env.NODE_ENV !== 'test'
    && !url.includes('connection_limit=')
    ? `${url}${url.includes('?') ? '&' : '?'}connection_limit=5`
    : url;
  process.env.DATABASE_URL = withPool;
  return withPool;
}

export function redactMysqlUrl(url) {
  return url.replace(/\/\/([^:/]+):([^@]+)@/, '//$1:***@');
}
