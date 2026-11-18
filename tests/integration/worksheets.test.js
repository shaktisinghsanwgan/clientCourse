import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { adminKey, JANE, JOHN, linkJane, registerPurchaser, signIn } from '../helpers.js';

const storageDir = path.join(os.tmpdir(), `customersync-worksheets-${process.pid}`);
process.env.WORKSHEET_STORAGE_DIR = storageDir;

const patches = [];
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

function mockPortalKajabi() {
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    const method = options.method || 'GET';
    const json = (body, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => body,
    });

    if (parsed.pathname.endsWith('/v1/oauth/token')) {
      return json({ access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' });
    }
    if (parsed.pathname.endsWith('/v1/custom_fields')) {
      return json({
        data: [{
          id: '20',
          type: 'custom_fields',
          attributes: { handle: 'custom_20', title: 'Partner Rating & Attachment URL', archived: false },
        }],
        meta: { total_pages: 1 },
      });
    }
    const contactPatch = parsed.pathname.match(/\/v1\/contacts\/([^/]+)$/);
    if (contactPatch && method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push({ id: decodeURIComponent(contactPatch[1]), attributes: body.data.attributes });
      return json({ data: { id: contactPatch[1], type: 'contacts' } });
    }
    if (parsed.pathname.endsWith('/v1/contacts')) {
      const email = (parsed.searchParams.get('filter[search]') || '').toLowerCase();
      const person = [JOHN, JANE].find((item) => item.email === email);
      if (!person) return json({ data: [] });
      return json({
        data: [{
          id: `contact-${person.id}`,
          type: 'contacts',
          attributes: { email: person.email },
          relationships: { customer: { data: { id: person.id, type: 'customers' } } },
        }],
      });
    }
    const customerById = parsed.pathname.match(/\/v1\/customers\/([^/]+)$/);
    if (customerById) {
      const customer = [JOHN, JANE].find((item) => item.id === decodeURIComponent(customerById[1]));
      if (!customer) return json({ errors: [{ title: 'not found' }] }, 404);
      return json({
        data: {
          id: customer.id,
          type: 'customers',
          attributes: { name: customer.name, email: customer.email },
          relationships: { contact: { data: { id: `contact-${customer.id}`, type: 'contacts' } } },
        },
      });
    }
    if (parsed.pathname.endsWith('/v1/customers')) {
      const email = (parsed.searchParams.get('filter[search]') || '').toLowerCase();
      const matches = [JOHN, JANE].filter((customer) => customer.email === email);
      return json({
        data: matches.map((customer) => ({
          id: customer.id,
          type: 'customers',
          attributes: { name: customer.name, email: customer.email },
        })),
      });
    }
    if (parsed.pathname.endsWith('/v1/purchases')) {
      const customerId = parsed.searchParams.get('filter[customer_id]');
      const customer = [JOHN, JANE].find((item) => item.id === customerId);
      if (!customer?.paid) return json({ data: [] });
      return json({
        data: [{
          id: `purchase-${customer.id}`,
          type: 'purchases',
          attributes: { deactivated_at: null },
          relationships: { offer: { data: { id: 'offer-1', type: 'offers' } } },
        }],
      });
    }
    return json({ errors: [{ title: 'not found' }] }, 404);
  };
}

function tokenFrom(url) {
  return new URL(url).pathname.split('/').filter(Boolean).pop();
}

async function openPair() {
  patches.length = 0;
  mockPortalKajabi();
  const registered = await registerPurchaser(JOHN);
  expect(registered.status).toBe(201);
  const purchaser = await signIn(JOHN.email);
  const linked = await linkJane(purchaser.token);
  expect(linked.status).toBe(200);
  await signIn(JANE.email);
  patches.length = 0;
  const synced = await request(app)
    .post('/api/v1/admin/portal-links/sync')
    .set('x-api-key', adminKey);
  expect(synced.status).toBe(200);
  const purchaserLink = synced.body.data.find((item) => item.email === JOHN.email);
  const partnerLink = synced.body.data.find((item) => item.email === JANE.email);
  return { purchaserLink, partnerLink };
}

afterAll(async () => {
  await fs.rm(storageDir, { recursive: true, force: true });
});

describe('weekly ratings and worksheets', () => {
  it('keeps purchaser and partner submissions separate and publishes portal URLs', async () => {
    const { purchaserLink, partnerLink } = await openPair();
    expect(purchaserLink.kajabiUpdated).toBe(true);
    expect(partnerLink.kajabiUpdated).toBe(true);
    expect(purchaserLink.portalUrl).not.toContain(JOHN.id);
    expect(purchaserLink.portalUrl).not.toContain('contact-');
    expect(partnerLink.portalUrl).not.toContain(JANE.email);

    const portalPatches = patches.filter((patch) => patch.attributes.custom_20);
    expect(portalPatches).toHaveLength(2);
    expect(portalPatches.map((patch) => patch.id).sort()).toEqual(['contact-kajabi_123', 'contact-kajabi_456']);
    portalPatches.forEach((patch) => {
      expect(Object.keys(patch.attributes)).toEqual(['custom_20']);
      expect(patch.attributes.custom_20).toMatch(/\/worksheets\/[A-Za-z0-9_-]{43}$/);
    });

    const purchaserToken = tokenFrom(purchaserLink.portalUrl);
    const partnerToken = tokenFrom(partnerLink.portalUrl);
    expect(purchaserToken).not.toBe(partnerToken);

    const page = await request(app).get(`/worksheets/${purchaserToken}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Weekly ratings and worksheets');
    expect(page.text).not.toContain(JOHN.id);

    const initial = await request(app).get(`/api/v1/worksheets/${purchaserToken}`);
    expect(initial.status).toBe(200);
    expect(initial.body.data.participant.role).toBe('purchaser');
    expect(initial.body.data.weeks).toHaveLength(8);
    expect(initial.body.data.progress.completedWeeks).toBe(0);
    expect(JSON.stringify(initial.body)).not.toContain(JANE.email);

    const draft = await request(app)
      .post(`/api/v1/worksheets/${purchaserToken}/ratings/draft`)
      .send({ weekNumber: 1, desireRating: 4, happinessRating: null, connectionRating: null });
    expect(draft.status).toBe(200);
    expect(draft.body.data.weeks[0].rating).toMatchObject({ desireRating: 4, status: 'draft' });
    expect(draft.body.data.weeks[0].status).toBe('in_progress');
    expect(draft.body.data.progress.completedWeeks).toBe(0);

    const refreshed = await request(app).get(`/api/v1/worksheets/${purchaserToken}`);
    expect(refreshed.body.data.weeks[0].rating.desireRating).toBe(4);

    const submitted = await request(app)
      .post(`/api/v1/worksheets/${purchaserToken}/ratings/submit`)
      .send({ weekNumber: 1, desireRating: 8, happinessRating: 7, connectionRating: 6 });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.weeks[0].rating.status).toBe('submitted');
    expect(submitted.body.data.progress.completedWeeks).toBe(0);

    const duplicate = await request(app)
      .post(`/api/v1/worksheets/${purchaserToken}/ratings/submit`)
      .send({ weekNumber: 1, desireRating: 8, happinessRating: 7, connectionRating: 6 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.errorCode).toBe('RATING_ALREADY_SUBMITTED');

    const uploaded = await request(app)
      .post(`/api/v1/worksheets/${purchaserToken}/files`)
      .field('weekNumber', '1')
      .field('worksheetKey', 'our-story')
      .attach('file', pdf, 'our-story.pdf');
    expect(uploaded.status).toBe(200);
    const file = uploaded.body.data.weeks[0].items.find((item) => item.key === 'our-story').file;
    expect(file.filename).toBe('our-story.pdf');
    expect(uploaded.body.data.progress.completedWeeks).toBe(0);

    const checked = await request(app)
      .post(`/api/v1/worksheets/${purchaserToken}/checklist`)
      .send({ weekNumber: 1, itemKey: 'week-1-checklist', completed: true });
    expect(checked.status).toBe(200);
    expect(checked.body.data.weeks[0].status).toBe('completed');
    expect(checked.body.data.progress).toMatchObject({ completedWeeks: 1, percent: 13, label: 'Week 2 of 8' });

    const edited = await request(app)
      .post(`/api/v1/worksheets/${purchaserToken}/ratings/submit`)
      .send({ weekNumber: 1, desireRating: 9, happinessRating: 9, connectionRating: 9, edit: true });
    expect(edited.status).toBe(200);
    expect(edited.body.data.weeks[0].rating.desireRating).toBe(9);

    const partnerView = await request(app).get(`/api/v1/worksheets/${partnerToken}`);
    expect(partnerView.status).toBe(200);
    expect(partnerView.body.data.participant.role).toBe('partner');
    expect(partnerView.body.data.weeks[0].rating).toBeNull();
    expect(partnerView.body.data.weeks[0].items.find((item) => item.key === 'our-story').file).toBeNull();

    const partnerWeek = await request(app)
      .post(`/api/v1/worksheets/${partnerToken}/ratings/submit`)
      .send({ weekNumber: 2, desireRating: 5, happinessRating: 5, connectionRating: 5 });
    expect(partnerWeek.status).toBe(200);
    const purchaserAfter = await request(app).get(`/api/v1/worksheets/${purchaserToken}/weeks/2`);
    expect(purchaserAfter.body.data.week.rating).toBeNull();

    const stolen = await request(app).get(`/api/v1/worksheets/${partnerToken}/files/${file.id}`);
    expect(stolen.status).toBe(404);

    const admin = await request(app)
      .get(`/api/v1/admin/participants/${purchaserLink.userId}`)
      .set('x-api-key', adminKey);
    expect(admin.status).toBe(200);
    expect(admin.body.data.purchaser.ratings[0].history[0]).toMatchObject({ desireRating: 8, status: 'submitted' });
    expect(admin.body.data.partner.ratings[0]).toMatchObject({ weekNumber: 2, desireRating: 5 });

    const download = await request(app)
      .get(`/api/v1/admin/participants/${purchaserLink.userId}/files/${file.id}`)
      .set('x-api-key', adminKey)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.body.subarray(0, 5).toString()).toBe('%PDF-');

    const replaced = await request(app)
      .post(`/api/v1/worksheets/${purchaserToken}/files`)
      .field('weekNumber', '1')
      .field('worksheetKey', 'our-story')
      .attach('file', pdf, 'replacement.pdf');
    const nextFile = replaced.body.data.weeks[0].items.find((item) => item.key === 'our-story').file;
    expect(nextFile.id).not.toBe(file.id);
    const oldFile = await request(app).get(`/api/v1/worksheets/${purchaserToken}/files/${file.id}`);
    expect(oldFile.status).toBe(404);

    const removed = await request(app).delete(`/api/v1/worksheets/${purchaserToken}/files/${nextFile.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.weeks[0].items.find((item) => item.key === 'our-story').file).toBeNull();
  });

  it('rejects invalid tokens, unauthorized admin access, and non-PDF uploads', async () => {
    const { purchaserLink } = await openPair();
    const token = tokenFrom(purchaserLink.portalUrl);

    const missing = await request(app).get(`/api/v1/worksheets/${'a'.repeat(43)}`);
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe('PORTAL_LINK_INVALID');

    const admin = await request(app).get('/api/v1/admin/participants');
    expect(admin.status).toBe(401);

    const disguised = await request(app)
      .post(`/api/v1/worksheets/${token}/files`)
      .field('weekNumber', '1')
      .field('worksheetKey', 'our-story')
      .attach('file', Buffer.from('not a pdf'), 'notes.pdf');
    expect(disguised.status).toBe(400);
    expect(disguised.body.errorCode).toBe('FILE_TYPE');

    const checklist = await request(app)
      .post(`/api/v1/worksheets/${token}/files`)
      .field('weekNumber', '1')
      .field('worksheetKey', 'week-1-checklist')
      .attach('file', pdf, 'checklist.pdf');
    expect(checklist.status).toBe(404);

    const invalidRating = await request(app)
      .post(`/api/v1/worksheets/${token}/ratings/submit`)
      .send({ weekNumber: 3, desireRating: 11, happinessRating: 1, connectionRating: 1 });
    expect(invalidRating.status).toBe(400);

    const adminPage = await request(app).get('/admin/participants');
    expect(adminPage.status).toBe(200);
    expect(adminPage.text).toContain('Worksheet admin');
  });
});
