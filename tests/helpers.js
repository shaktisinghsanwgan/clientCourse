import request from 'supertest';
import { app } from '../src/app.js';

export const adminKey = process.env.ADMIN_API_KEY;

export function mockKajabi(customers) {
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    const json = (body, status = 200) => ({
      ok: status < 400,
      status,
      json: async () => body,
    });

    if (parsed.pathname.endsWith('/v1/oauth/token')) {
      return json({ access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' });
    }

    if (parsed.pathname.endsWith('/v1/customers')) {
      const email = (parsed.searchParams.get('filter[search]') || '').toLowerCase();
      const matches = customers.filter((customer) => customer.email === email);
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
      const customer = customers.find((item) => item.id === customerId);
      if (!customer?.paid) {
        return json({ data: [] });
      }
      return json({
        data: [{
          id: customer.purchaseId || `purchase-${customer.id}`,
          type: 'purchases',
          attributes: { deactivated_at: null },
          relationships: {
            offer: { data: { id: customer.offerId || 'offer-1', type: 'offers' } },
          },
        }],
      });
    }

    return json({ errors: [{ title: 'not found' }] }, 404);
  };
}

export const JOHN = {
  id: 'kajabi_123',
  email: 'john@example.com',
  name: 'John Doe',
  paid: true,
};

export const JANE = {
  id: 'kajabi_456',
  email: 'jane@example.com',
  name: 'Jane Doe',
  paid: false,
};

export function sampleChapters(counts = [5, 4, 6, 5, 4, 6, 5, 4]) {
  return counts.flatMap((count, index) => {
    const weekNumber = index + 1;
    return Array.from({ length: count }, (_, chapterIndex) => ({
      weekNumber,
      chapterId: `week-${weekNumber}-chapter-${chapterIndex + 1}`,
      chapterName: `Week ${weekNumber} Chapter ${chapterIndex + 1}`,
      chapterOrder: chapterIndex + 1,
      isActive: true,
    }));
  });
}

export async function syncChapterStructure(chapters = sampleChapters()) {
  const response = await request(app)
    .post('/api/v1/chapters/sync')
    .set('x-api-key', adminKey)
    .send({ chapters });
  if (response.status !== 200) {
    throw new Error(`Chapter sync failed: ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

export async function registerPurchaser(person, extra = {}) {
  return request(app)
    .post('/api/v1/users/register')
    .set('x-api-key', adminKey)
    .send({
      name: person.name,
      email: person.email,
      kajabiCustomerId: person.id,
      ...extra,
    });
}

export async function signIn(email) {
  const response = await request(app).post('/api/v1/users/login').send({ email });
  if (response.status !== 200) {
    throw new Error(`Sign in failed: ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

export function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function completeChapter(token, chapterId, completed = true) {
  return request(app)
    .post('/api/v1/chapters/complete')
    .set(bearer(token))
    .send({ chapterId, completed });
}

export async function linkJane(token) {
  return request(app)
    .post('/api/v1/partners/link')
    .set(bearer(token))
    .send({ partnerName: 'Jane Doe', partnerEmail: 'jane@example.com' });
}
