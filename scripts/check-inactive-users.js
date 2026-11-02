import { prisma } from '../src/config/database.js';
import { notifyInactiveUsers } from '../src/services/inactivity.service.js';
import { notifyMissingPartnerInvites } from '../src/services/partner-invite-notice.service.js';

try {
  const summary = await notifyInactiveUsers();
  const invites = await notifyMissingPartnerInvites();
  console.log(JSON.stringify({ inactivity: summary, partnerInvites: invites }, null, 2));
  if (summary.failed > 0 || invites.failed > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
