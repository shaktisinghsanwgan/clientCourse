import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/config/database.js';
import {
  JANE,
  JOHN,
  bearer,
  completeChapter,
  signIn,
  linkJane,
  mockKajabi,
  registerPurchaser,
  sampleChapters,
  syncChapterStructure,
} from '../helpers.js';

const WEEK_COUNTS = [5, 4, 6, 5, 4, 6, 5, 4];

beforeEach(() => {
  mockKajabi([JOHN, { ...JANE, paid: false }]);
});

async function setupActivePartnership() {
  const registration = await registerPurchaser(JOHN);
  expect(registration.status).toBe(201);
  expect(registration.body.data.user.kajabiUserId).toBe('kajabi_123');

  const john = await signIn('john@example.com');
  const linked = await linkJane(john.token);
  expect(linked.status).toBe(200);
  expect(linked.body.data.status).toBe('PENDING');

  const jane = await signIn('jane@example.com');
  expect(jane.user.role).toBe('PARTNER');
  expect(jane.partnership.status).toBe('ACTIVE');
  await syncChapterStructure();
  return { john, jane, johnId: registration.body.data.user.id };
}

async function completeWeek(token, weekNumber) {
  const count = WEEK_COUNTS[weekNumber - 1];
  let response;
  for (let index = 1; index <= count; index += 1) {
    response = await completeChapter(token, `week-${weekNumber}-chapter-${index}`);
    expect(response.status).toBe(200);
  }
  return response.body.data;
}

describe('partner course synchronization', () => {
  it('registers a purchaser from a verified Kajabi purchase and logs in an existing user', async () => {
    const first = await registerPurchaser(JOHN);
    expect(first.status).toBe(201);
    const second = await registerPurchaser({ ...JOHN, name: 'John Updated' });
    expect(second.status).toBe(200);
    expect(await prisma.user.count()).toBe(1);

    const login = await signIn('john@example.com');
    const again = await signIn('john@example.com');
    expect(again.user.email).toBe('john@example.com');
    expect(again.token).toEqual(expect.any(String));

    const me = await request(app).get('/api/v1/users/me').set(bearer(login.token));
    expect(me.status).toBe(200);
    expect(me.body.data.emailVerified).toBe(true);
  });

  it('rejects client payment flags and does not call Kajabi when the API is not configured', async () => {
    const spoofed = await request(app)
      .post('/api/v1/users/register')
      .set('x-api-key', process.env.ADMIN_API_KEY)
      .send({ name: 'John Doe', email: 'john@example.com', paymentStatus: 'PAID' });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.errorCode).toBe('VALIDATION_ERROR');

    const originalKey = process.env.KAJABI_API_KEY;
    let called = false;
    global.fetch = () => {
      called = true;
      throw new Error('Kajabi should not be called');
    };
    delete process.env.KAJABI_API_KEY;
    try {
      const pending = await registerPurchaser(JOHN);
      expect(pending.status).toBe(201);
      expect(pending.body.data.user.paymentStatus).toBeUndefined();
      expect(pending.body.data.user.kajabiUserId).toBeNull();
      expect(called).toBe(false);
    } finally {
      process.env.KAJABI_API_KEY = originalKey;
    }
  });

  it('links a Kajabi customer only after the official API confirms the email', async () => {
    await registerPurchaser(JOHN);
    const john = await signIn('john@example.com');
    const sync = await request(app)
      .post('/api/v1/users/sync')
      .set(bearer(john.token))
      .send({ kajabiCustomerId: 'kajabi_123' });
    expect(sync.status).toBe(200);
    expect(sync.body.data.identity.linked).toBe(true);

    const conflict = await request(app)
      .post('/api/v1/users/sync')
      .set(bearer(john.token))
      .send({ kajabiCustomerId: 'someone-else' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.errorCode).toBe('IDENTITY_CONFLICT');
  });

  it('rejects a Kajabi id that already belongs to another user', async () => {
    await registerPurchaser(JOHN);
    mockKajabi([
      JOHN,
      { ...JANE, id: 'kajabi_123', paid: true },
    ]);
    const conflict = await registerPurchaser({ ...JANE, paid: true });
    expect(conflict.status).toBe(409);
    expect(conflict.body.errorCode).toBe('IDENTITY_CONFLICT');
  });

  it('requires the admin API key and a valid JWT', async () => {
    const missingKey = await request(app)
      .post('/api/v1/chapters/sync')
      .send({ chapters: sampleChapters([1]) });
    expect(missingKey.status).toBe(401);
    expect(missingKey.body.errorCode).toBe('UNAUTHORIZED');

    const missingToken = await request(app).get('/api/v1/users/me');
    expect(missingToken.status).toBe(401);

    await registerPurchaser(JOHN);
    const john = await signIn('john@example.com');
    const expired = jwt.sign(
      { sub: String(john.user.id) },
      process.env.JWT_SECRET,
      { expiresIn: '-10s' },
    );
    const rejected = await request(app).get('/api/v1/users/me').set(bearer(expired));
    expect(rejected.status).toBe(401);
    expect(rejected.body.errorCode).toBe('TOKEN_EXPIRED');
  });

  it('links Jane, prevents duplicates, and activates her on verified email login', async () => {
    await registerPurchaser(JOHN);
    const john = await signIn('john@example.com');
    const selfLink = await request(app)
      .post('/api/v1/partners/link')
      .set(bearer(john.token))
      .send({ partnerName: 'John Doe', partnerEmail: 'john@example.com' });
    expect(selfLink.status).toBe(409);
    expect(selfLink.body.errorCode).toBe('SELF_PARTNER');

    const linked = await linkJane(john.token);
    expect(linked.status).toBe(200);

    const bobRegistration = await registerPurchaser({
      id: 'kajabi_789',
      email: 'bob@example.com',
      name: 'Bob Roe',
      paid: true,
    });
    expect(bobRegistration.status).toBe(201);
    const bob = await signIn('bob@example.com');
    const duplicate = await request(app)
      .post('/api/v1/partners/link')
      .set(bearer(bob.token))
      .send({ partnerName: 'Jane Doe', partnerEmail: 'jane@example.com' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.errorCode).toBe('DUPLICATE_PARTNER');

    const jane = await signIn('jane@example.com');
    const partnership = await request(app).get('/api/v1/partners/me').set(bearer(jane.token));
    expect(partnership.status).toBe(200);
    expect(partnership.body.data.userId).toBe(jane.user.id);
    expect(partnership.body.data.status).toBe('ACTIVE');
    expect(partnership.body.data.partner.id).toBe(jane.user.id);
    expect(partnership.body.data.partner.email).toBe('jane@example.com');

    const johnView = await request(app).get('/api/v1/partners/me').set(bearer(john.token));
    expect(johnView.status).toBe(200);
    expect(johnView.body.data.userId).toBe(john.user.id);
    expect(johnView.body.data.partner.email).toBe('jane@example.com');

    const byEmail = await request(app)
      .get('/api/v1/progress/partner')
      .query({ purchaserEmail: 'john@example.com' });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data.purchaser.email).toBe('john@example.com');
    expect(byEmail.body.data.partner.email).toBe('jane@example.com');
    expect(byEmail.body.data.partner.weeks).toHaveLength(8);

    const course = await request(app)
      .get('/api/v1/course')
      .query({ purchaserEmail: 'john@example.com' });
    expect(course.status).toBe(200);
    expect(course.body.data.partner.email).toBe('jane@example.com');

    const missing = await request(app)
      .get('/api/v1/progress/partner')
      .query({ purchaserEmail: 'nobody@example.com' });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('No partner found');
  });

  it('verifies role by user id, updates either person, and saves progress by chapter name', async () => {
    const { john, jane } = await setupActivePartnership();

    const purchaser = await request(app).get(`/api/v1/users/${john.user.id}`);
    expect(purchaser.status).toBe(200);
    expect(purchaser.body.data.kind).toBe('purchaser');
    expect(purchaser.body.data.isPurchaser).toBe(true);
    expect(purchaser.body.data.isPartner).toBe(false);

    const partner = await request(app).get(`/api/v1/users/${jane.user.id}`);
    expect(partner.status).toBe(200);
    expect(partner.body.data.kind).toBe('partner');

    const linked = await request(app)
      .post('/api/v1/partners/link')
      .set('x-api-key', process.env.ADMIN_API_KEY)
      .send({
        purchaserUserId: john.user.id,
        partnerName: 'Jane Doe',
        partnerEmail: 'jane@example.com',
      });
    expect(linked.status).toBe(200);
    expect(linked.body.data.partnerEmail).toBe('jane@example.com');

    const renamed = await request(app).patch(`/api/v1/users/${jane.user.id}`).send({
      name: 'Jane Updated',
      email: 'jane@example.com',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Jane Updated');
    expect(renamed.body.data.role).toBe('PARTNER');

    const course = await request(app).get('/api/v1/course/sync').query({ userId: john.user.id });
    expect(course.status).toBe(200);
    expect(course.body.user.id).toBe(john.user.id);
    expect(course.body.user.weeks).toHaveLength(8);
    expect(course.body.partner.email).toBe('jane@example.com');
    expect(course.body.partner.weeks).toHaveLength(8);

    const saved = await request(app).post('/api/v1/chapters/progress').send({
      userId: john.user.id,
      chapters: [{ chapterName: 'Week 1 Chapter 1', completed: true }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.userId).toBe(john.user.id);
    expect(saved.body.data.updates[0].user.completedChapters).toBe(1);

    const unknown = await request(app).get('/api/v1/users/99999');
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('User not found');
  });

  it('recognizes a Kajabi cookie id and saves the lesson the member just completed', async () => {
    const { john } = await setupActivePartnership();
    const kajabiUserId = 'RS_ENC_v3_member_cookie';
    const missing = await request(app).get('/api/v1/users/lookup').query({ kajabiUserId });
    expect(missing.status).toBe(404);

    const bound = await request(app)
      .post('/api/v1/users/bind')
      .set('x-api-key', process.env.ADMIN_API_KEY)
      .send({ name: 'John Doe', email: 'john@example.com', kajabiUserId });
    expect(bound.status).toBe(200);
    expect(bound.body.data.userId).toBe(john.user.id);
    expect(bound.body.data.isPurchaser).toBe(true);
    expect(bound.body.data.user.kajabiUserId).toBe(kajabiUserId);

    const found = await request(app).get('/api/v1/users/lookup').query({ kajabiUserId });
    expect(found.status).toBe(200);
    expect(found.body.message).toBe('Purchaser');

    const saved = await request(app).post('/api/v1/chapters/progress').send({
      kajabiUserId,
      chapters: [{
        chapterName: 'Course Orientation Video',
        weekNumber: 1,
        chapterId: '2200999846',
        completed: true,
      }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.updates[0].weekNumber).toBe(1);
    expect(saved.body.data.updates[0].user.completedChapters).toBe(1);

    const course = await request(app).get('/api/v1/course/sync').query({ kajabiUserId });
    expect(course.status).toBe(200);
    expect(course.body.user.email).toBe('john@example.com');
    const orientation = course.body.user.weeks[0].chapters.find((chapter) => chapter.chapterName === 'Course Orientation Video');
    expect(orientation.completed).toBe(true);
  });

  it('keeps Week 2 locked until both partners finish Week 1, including when the partner finishes first', async () => {
    const { john, jane } = await setupActivePartnership();

    const early = await completeChapter(john.token, 'week-2-chapter-1');
    expect(early.status).toBe(403);
    expect(early.body.errorCode).toBe('WEEK_LOCKED');

    for (let index = 1; index <= 5; index += 1) {
      const response = await completeChapter(jane.token, `week-1-chapter-${index}`);
      expect(response.status).toBe(200);
    }
    for (let index = 1; index <= 3; index += 1) {
      const response = await completeChapter(john.token, `week-1-chapter-${index}`);
      expect(response.status).toBe(200);
    }

    const waiting = await request(app)
      .get('/api/v1/progress/week/1')
      .set(bearer(john.token));
    expect(waiting.status).toBe(200);
    expect(waiting.body.data.user.progressPercentage).toBe(60);
    expect(waiting.body.data.partner.progressPercentage).toBe(100);
    expect(waiting.body.data.partnershipCompleted).toBe(false);
    expect(waiting.body.data.nextWeekUnlocked).toBe(false);
    expect(waiting.body.data.message).toContain('remaining');

    const lockedChapters = await request(app)
      .get('/api/v1/chapters/week/2')
      .set(bearer(jane.token));
    expect(lockedChapters.status).toBe(403);
    expect(lockedChapters.body.errorCode).toBe('WEEK_LOCKED');

    await completeChapter(john.token, 'week-1-chapter-4');
    const unlocked = await completeChapter(john.token, 'week-1-chapter-5');
    expect(unlocked.body.data.user.progressPercentage).toBe(100);
    expect(unlocked.body.data.partner.progressPercentage).toBe(100);
    expect(unlocked.body.data.partnership.weekCompleted).toBe(true);
    expect(unlocked.body.data.partnership.nextWeekUnlocked).toBe(true);

    const sync = await request(app).get('/api/v1/course/sync').set(bearer(john.token));
    expect(sync.body.course.currentWeek).toBe(2);
    expect(sync.body.user.weeks).toHaveLength(8);
    expect(sync.body.user.weeks[0].completed).toBe(true);
    expect(sync.body.user.weeks[1].unlocked).toBe(true);
    expect(sync.body.user.weeks[1].totalChapters).toBe(4);
    expect(sync.body.partner.weeks[1].unlocked).toBe(true);
    expect(sync.body.course.courseCompleted).toBe(false);
    expect(sync.body.synchronization.nextWeekUnlocked).toBe(false);
  });

  it('treats duplicate completion as idempotent and locks future weeks after a reversal', async () => {
    const { john, jane, johnId } = await setupActivePartnership();
    await completeWeek(jane.token, 1);
    await completeWeek(john.token, 1);

    const duplicate = await completeChapter(john.token, 'week-1-chapter-1');
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.partnership.nextWeekUnlocked).toBe(true);
    const rows = await prisma.chapterProgress.count({
      where: { userId: BigInt(johnId), chapterId: 'week-1-chapter-1' },
    });
    expect(rows).toBe(1);

    const reversed = await completeChapter(john.token, 'week-1-chapter-1', false);
    expect(reversed.body.data.user.progressPercentage).toBe(80);
    expect(reversed.body.data.partnership.nextWeekUnlocked).toBe(false);

    const blocked = await completeChapter(jane.token, 'week-2-chapter-1');
    expect(blocked.status).toBe(403);
    expect(blocked.body.errorCode).toBe('WEEK_LOCKED');

    const restored = await completeChapter(john.token, 'week-1-chapter-1', true);
    expect(restored.body.data.partnership.nextWeekUnlocked).toBe(true);
  });

  it('serializes simultaneous completions and unlocks the next week once', async () => {
    const { john, jane } = await setupActivePartnership();
    for (let index = 1; index <= 4; index += 1) {
      expect((await completeChapter(john.token, `week-1-chapter-${index}`)).status).toBe(200);
      expect((await completeChapter(jane.token, `week-1-chapter-${index}`)).status).toBe(200);
    }

    const [johnResult, janeResult] = await Promise.all([
      completeChapter(john.token, 'week-1-chapter-5'),
      completeChapter(jane.token, 'week-1-chapter-5'),
    ]);
    expect(johnResult.status).toBe(200);
    expect(janeResult.status).toBe(200);

    const sync = await request(app).get('/api/v1/course/sync').set(bearer(john.token));
    expect(sync.body.user.weeks[0].progressPercentage).toBe(100);
    expect(sync.body.partner.weeks[0].progressPercentage).toBe(100);
    expect(sync.body.user.weeks[1].unlocked).toBe(true);
    expect(sync.body.partner.weeks[1].unlocked).toBe(true);

    const records = await prisma.chapterProgress.count({
      where: { chapterId: 'week-1-chapter-5' },
    });
    expect(records).toBe(2);
  });

  it('rejects unknown lessons, inactive chapters, other users, and a missing partner', async () => {
    const { john } = await setupActivePartnership();
    const unknown = await completeChapter(john.token, 'missing-chapter');
    expect(unknown.status).toBe(404);
    expect(unknown.body.errorCode).toBe('CHAPTER_NOT_FOUND');

    const spoofed = await request(app)
      .post('/api/v1/chapters/complete')
      .set(bearer(john.token))
      .send({ chapterId: 'week-1-chapter-1', completed: true, userId: 999, progressPercentage: 100 });
    expect(spoofed.status).toBe(400);

    await request(app)
      .patch('/api/v1/chapters/week-1-chapter-5/active')
      .set('x-api-key', process.env.ADMIN_API_KEY)
      .send({ isActive: false });
    const inactive = await completeChapter(john.token, 'week-1-chapter-5');
    expect(inactive.status).toBe(409);
    expect(inactive.body.errorCode).toBe('CHAPTER_INACTIVE');

    const bob = await registerPurchaser({
      id: 'kajabi_789',
      email: 'bob@example.com',
      name: 'Bob Roe',
      paid: true,
    });
    const bobLogin = await signIn('bob@example.com');
    const denied = await completeChapter(bobLogin.token, 'week-1-chapter-1');
    expect(denied.status).toBe(404);
    expect(denied.body.errorCode).toBe('PARTNER_NOT_FOUND');
    expect(denied.body.message).toBe('No partner found');
    const missingPartner = await request(app).get('/api/v1/partners/me').set(bearer(bobLogin.token));
    expect(missingPartner.status).toBe(404);
    expect(missingPartner.body.message).toBe('No partner found');
    const bobSync = await request(app).get('/api/v1/course/sync').set(bearer(bobLogin.token));
    expect(bobSync.body.partner).toBeNull();
    expect(JSON.stringify(bobSync.body)).not.toContain('jane@example.com');
    expect(bob.body.data.user.email).toBe('bob@example.com');

    mockKajabi([{ ...JOHN, paid: false }, JANE]);
    const unpaid = await registerPurchaser({
      id: 'kajabi_321',
      email: 'mary@example.com',
      name: 'Mary Roe',
      paid: false,
    });
    expect(unpaid.body.data.user.paymentStatus).toBeUndefined();
    const mary = await signIn('mary@example.com');
    await request(app)
      .post('/api/v1/partners/link')
      .set(bearer(mary.token))
      .send({ partnerName: 'Alex Roe', partnerEmail: 'alex@example.com' });
    const alex = await signIn('alex@example.com');
    const maryPartner = await request(app).get('/api/v1/partners/me').set(bearer(mary.token));
    expect(maryPartner.status).toBe(200);
    expect(maryPartner.body.data.partner.email).toBe('alex@example.com');
    expect(maryPartner.body.data.partner.id).toBe(alex.user.id);
    const opened = await completeChapter(mary.token, 'week-1-chapter-1');
    expect(opened.status).toBe(200);
  });

  it('recalculates progress when the chapter structure changes and ignores empty weeks', async () => {
    const { john, jane, johnId } = await setupActivePartnership();
    await completeWeek(john.token, 1);
    await completeWeek(jane.token, 1);

    const added = await request(app)
      .post('/api/v1/chapters')
      .set('x-api-key', process.env.ADMIN_API_KEY)
      .send({
        weekNumber: 1,
        chapterId: 'week-1-chapter-6',
        chapterName: 'Extra chapter',
        chapterOrder: 6,
        isActive: true,
      });
    expect(added.status).toBe(201);

    const sync = await request(app).get('/api/v1/course/sync').set(bearer(john.token));
    expect(sync.body.user.weeks[0].totalChapters).toBe(6);
    expect(sync.body.user.weeks[0].completedChapters).toBe(5);
    expect(sync.body.user.weeks[0].progressPercentage).toBe(83.33);
    expect(sync.body.user.weeks[1].unlocked).toBe(false);

    const stored = await prisma.progress.findUnique({
      where: { userId_weekNumber: { userId: BigInt(johnId), weekNumber: 1 } },
    });
    expect(stored.completed).toBe(false);
    expect(Number(stored.completedChapters)).toBe(5);

    await request(app)
      .patch('/api/v1/chapters/week-1-chapter-6/active')
      .set('x-api-key', process.env.ADMIN_API_KEY)
      .send({ isActive: false });
    const restored = await request(app).get('/api/v1/progress/week/1').set(bearer(john.token));
    expect(restored.body.data.partnershipCompleted).toBe(true);
    expect(restored.body.data.nextWeekUnlocked).toBe(true);

    const history = await prisma.chapterProgress.count({
      where: { userId: BigInt(johnId), chapterId: 'week-1-chapter-1', completed: true },
    });
    expect(history).toBe(1);

    for (let index = 1; index <= 5; index += 1) {
      const deactivated = await request(app)
        .patch(`/api/v1/chapters/week-1-chapter-${index}/active`)
        .set('x-api-key', process.env.ADMIN_API_KEY)
        .send({ isActive: false });
      expect(deactivated.status).toBe(200);
    }

    const emptyWeek = await request(app).get('/api/v1/progress/week/1').set(bearer(john.token));
    expect(emptyWeek.body.data.user.totalChapters).toBe(0);
    expect(emptyWeek.body.data.partnershipCompleted).toBe(false);
    expect(emptyWeek.body.data.nextWeekUnlocked).toBe(false);
    expect(emptyWeek.body.data.message).toBe('No active chapters are configured for this week.');

    const weekTwo = await request(app).get('/api/v1/chapters/week/2').set(bearer(john.token));
    expect(weekTwo.status).toBe(403);
    expect(weekTwo.body.errorCode).toBe('WEEK_LOCKED');
  });

  it('completes all 8 weeks for both partners and never opens week 9', async () => {
    const { john, jane } = await setupActivePartnership();

    for (let week = 1; week <= 8; week += 1) {
      const janeResult = await completeWeek(jane.token, week);
      if (week < 8) {
        expect(janeResult.partnership.nextWeekUnlocked).toBe(false);
      }
      const johnResult = await completeWeek(john.token, week);
      if (week < 8) {
        expect(johnResult.partnership.nextWeekUnlocked).toBe(true);
        expect(johnResult.partnership.courseCompleted).toBe(false);
      } else {
        expect(johnResult.partnership.courseCompleted).toBe(true);
        expect(johnResult.partnership.nextWeekUnlocked).toBe(false);
      }
    }

    const sync = await request(app).get('/api/v1/course/sync').set(bearer(jane.token));
    expect(sync.body.course.courseCompleted).toBe(true);
    expect(sync.body.course.currentWeek).toBe(8);
    expect(sync.body.course.totalWeeks).toBe(8);
    expect(sync.body.user.weeks).toHaveLength(8);
    expect(sync.body.partner.weeks.every((week) => week.completed)).toBe(true);
    expect(sync.body.synchronization.nextAvailableWeek).toBeNull();
    expect(sync.body.synchronization.message).toBe('Both partners completed the course.');

    const weekNine = await request(app).get('/api/v1/progress/week/9').set(bearer(john.token));
    expect(weekNine.status).toBe(400);
    expect(weekNine.body.errorCode).toBe('INVALID_WEEK');

    const futureRows = await prisma.progress.count({ where: { weekNumber: { gt: 8 } } });
    expect(futureRows).toBe(0);

    const primaryRows = await prisma.progress.count({ where: { completed: true } });
    expect(primaryRows).toBe(16);
  });

  it('verifies Kajabi purchase webhooks with the API instead of trusting the payload', async () => {
    const denied = await request(app)
      .post('/api/v1/integrations/kajabi/webhook?token=wrong')
      .send({ event: 'purchase', payload: [] });
    expect(denied.status).toBe(401);

    mockKajabi([{ ...JOHN, paid: false }]);
    const unverified = await request(app)
      .post('/api/v1/integrations/kajabi/webhook?token=test-webhook-secret')
      .send({
        event: 'purchase',
        payload: [
          { id: 'kajabi_123', type: 'customers', attributes: { email: 'john@example.com', name: 'John Doe' } },
          { id: 'purchase-1', type: 'purchases', attributes: {} },
        ],
      });
    expect(unverified.status).toBe(409);
    expect(unverified.body.errorCode).toBe('PURCHASE_NOT_VERIFIED');
    expect(await prisma.user.count()).toBe(0);

    mockKajabi([JOHN]);
    const verified = await request(app)
      .post('/api/v1/integrations/kajabi/webhook?token=test-webhook-secret')
      .send({
        event: 'purchase',
        payload: [
          { id: 'kajabi_123', type: 'customers', attributes: { email: 'john@example.com', name: 'John Doe' } },
          { id: 'purchase-kajabi_123', type: 'purchases', attributes: {} },
        ],
      });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.kajabiUserId).toBe('kajabi_123');

    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.data.database).toBe('up');
  });
});
