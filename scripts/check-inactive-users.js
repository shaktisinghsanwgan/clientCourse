import { prisma } from '../src/config/database.js';
import { notifyInactiveUsers } from '../src/services/inactivity.service.js';
import { notifyMissingPartnerInvites } from '../src/services/partner-invite-notice.service.js';

try {
  const inactive = await notifyInactiveUsers();
  const invites = await notifyMissingPartnerInvites();
  const summary = { inactive, invites };
  console.log(JSON.stringify(summary, null, 2));
  if (inactive.failed > 0 || invites.failed > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
