import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { ensureDatabaseUrl, redactMysqlUrl } from '../src/config/database-url.js';

dotenv.config();

const databaseUrl = ensureDatabaseUrl({ pool: false });
if (!databaseUrl) {
  console.error(`DATABASE_URL is not set, and no Railway MySQL variables were found.

On the API service in Railway, open Variables and add a reference to the MySQL service:

  DATABASE_URL=\${{MySQL.MYSQL_URL}}
  JWT_SECRET=<a long random string>

The service name inside \${{...}} must match the MySQL service name in this project.
Use the private MYSQL_URL, not MYSQL_PUBLIC_URL.
Then redeploy the API service.`);
  process.exit(1);
}

console.log(`Database ${redactMysqlUrl(databaseUrl)}`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

try {
  await run('npx', ['prisma', 'migrate', 'deploy']);
  await run('node', ['src/server.js']);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
