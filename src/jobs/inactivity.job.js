import cron from 'node-cron';
import { env } from '../config/env.js';
import { notifyInactiveUsers } from '../services/inactivity.service.js';

let running = false;
let task;

export function startInactivityCron() {
  if (env.NODE_ENV === 'test' || task) return task;

  if (!cron.validate(env.INACTIVITY_CRON)) {
    throw new Error(`Invalid INACTIVITY_CRON schedule: ${env.INACTIVITY_CRON}`);
  }

  task = cron.schedule(env.INACTIVITY_CRON, async () => {
    if (running) return;
    running = true;
    try {
      const summary = await notifyInactiveUsers();
      console.log(
        `Inactivity check finished: ${summary.checked} inactive, ${summary.notified} emailed, ${summary.skipped} already sent, ${summary.unconfigured} waiting for mail settings, ${summary.failed} failed`,
      );
    } catch (error) {
      console.error(`Inactivity check failed: ${error.message}`);
    } finally {
      running = false;
    }
  }, { name: 'inactivity-check', noOverlap: true });

  console.log(`Inactivity check scheduled (${env.INACTIVITY_CRON})`);
  return task;
}

export function stopInactivityCron() {
  if (!task) return;
  task.stop();
  task = undefined;
}
