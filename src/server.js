import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { startInactivityCron, stopInactivityCron } from './jobs/inactivity.job.js';
import { notifyMissingPartnerInvites } from './services/partner-invite-notice.service.js';

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`API listening on port ${env.PORT}`);
  startInactivityCron();
  notifyMissingPartnerInvites()
    .then((summary) => {
      console.log(
        `Partner invite check finished: ${summary.checked} without a partner, ${summary.notified} emailed, ${summary.skipped} waiting for the next 48 hours, ${summary.unconfigured} waiting for mail settings, ${summary.failed} failed`,
      );
    })
    .catch((error) => {
      console.error(`Partner invite check failed: ${error.message}`);
    });
});

async function shutdown() {
  stopInactivityCron();
  server.close();
  await prisma.$disconnect();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
