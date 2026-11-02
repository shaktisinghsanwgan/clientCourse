import { prisma } from '../src/config/database.js';
import { notifyInactiveUsers } from '../src/services/inactivity.service.js';

try {
  const summary = await notifyInactiveUsers();
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
