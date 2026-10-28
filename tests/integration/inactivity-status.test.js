import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import { notifyInactiveUsers } from '../../src/services/inactivity.service.js';
import { JANE, JOHN, bearer, linkJane, mockKajabi, registerPurchaser, signIn } from '../helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mockKajabi([JOHN, { ...JANE, paid: false }]);
});

async function activePair() {
  const registration = await registerPurchaser(JOHN);
  expect(registration.status).toBe(201);
  const john = await signIn(JOHN.email);
  const linked = await linkJane(john.token);
  expect(linked.status).toBe(200);
  const jane = await signIn(JANE.email);
  expect(jane.user.role).toBe('PARTNER');
  return { john, jane };
}

function captureMail() {
  const sent = [];
  return {
    sent,
    send: async (payload) => {
      sent.push(payload);
      return { delivered: true };
    },
  };
}

describe('inactivity email and live status', () => {
  it('emails the other client once when a user has been inactive for more than a week', async () => {
    await activePair();
    const now = new Date();
    const stale = new Date(now.getTime() - (8 * DAY_MS));
    await prisma.user.update({
      where: { email: JANE.email },
      data: { lastActivityAt: stale },
    });

    const mail = captureMail();
    const first = await notifyInactiveUsers({ send: mail.send, now });
    expect(first.notified).toBe(1);
    expect(first.failed).toBe(0);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(JOHN.email);
    expect(mail.sent[0].inactiveUser.email).toBe(JANE.email);
    expect(mail.sent[0].inactiveUser.name).toBe('Jane Doe');
    expect(mail.sent[0].days).toBe(7);

    const second = await notifyInactiveUsers({ send: mail.send, now });
    expect(second.notified).toBe(0);
    expect(second.skipped).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(await prisma.inactivityNotice.count()).toBe(1);
  });

  it('does not email a client whose last activity is exactly one week old', async () => {
    await activePair();
    const now = new Date();
    await prisma.user.update({
      where: { email: JANE.email },
      data: { lastActivityAt: new Date(now.getTime() - (7 * DAY_MS)) },
    });

    const mail = captureMail();
    const summary = await notifyInactiveUsers({ send: mail.send, now });
    expect(summary.checked).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('refreshes live status for the polling client and reports a partner inactive for a week', async () => {
    const { john } = await activePair();
    const stale = new Date(Date.now() - (8 * DAY_MS));
    await prisma.user.update({
      where: { email: JANE.email },
      data: { lastActivityAt: stale, lastSeenAt: stale },
    });
    await prisma.user.update({
      where: { email: JOHN.email },
      data: { lastActivityAt: stale, lastSeenAt: stale },
    });

    const response = await request(app)
      .get('/api/v1/status/sync')
      .query({ kajabiUserId: JOHN.id });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.user.email).toBe(JOHN.email);
    expect(response.body.data.user.live).toBe(true);
    expect(response.body.data.user.inactiveForWeek).toBe(true);
    expect(response.body.data.partner.email).toBe(JANE.email);
    expect(response.body.data.partner.inactiveForWeek).toBe(true);
    expect(response.body.data.partner.live).toBe(false);
    expect(response.body.data.inactivityThresholdDays).toBe(7);

    const johnRecord = await prisma.user.findUnique({ where: { email: JOHN.email } });
    expect(Date.now() - johnRecord.lastSeenAt.getTime()).toBeLessThan(60 * 1000);
    expect(Date.now() - johnRecord.lastActivityAt.getTime()).toBeGreaterThan(7 * DAY_MS);

    const authed = await request(app)
      .post('/api/v1/status/sync')
      .set(bearer(john.token));
    expect(authed.status).toBe(200);
    expect(authed.body.data.user.live).toBe(true);

    const mail = captureMail();
    const summary = await notifyInactiveUsers({ send: mail.send });
    expect(summary.notified).toBe(2);
    const recipientByUser = Object.fromEntries(mail.sent.map((item) => [item.inactiveUser.email, item.to]));
    expect(recipientByUser[JANE.email]).toBe(JOHN.email);
    expect(recipientByUser[JOHN.email]).toBe(JANE.email);
  });
});
