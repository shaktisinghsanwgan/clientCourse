import { pathToFileURL } from 'node:url';

const BASE_URL = (process.env.API_BASE_URL || 'https://web-production-b4f12.up.railway.app').replace(/\/$/, '');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'local-dev-admin-key';

async function api(path, { method = 'GET', body, token, admin = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin) headers['X-Api-Key'] = ADMIN_API_KEY;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

function sampleChapters() {
  const counts = [5, 4, 6, 5, 4, 6, 5, 4];
  return counts.flatMap((count, weekIndex) => {
    const weekNumber = weekIndex + 1;
    return Array.from({ length: count }, (_, chapterIndex) => ({
      weekNumber,
      chapterId: `week-${weekNumber}-chapter-${chapterIndex + 1}`,
      chapterName: `Week ${weekNumber} Chapter ${chapterIndex + 1}`,
      chapterOrder: chapterIndex + 1,
      isActive: true,
    }));
  });
}

export function syncChapters(chapters = sampleChapters()) {
  return api('/api/v1/chapters/sync', {
    method: 'POST',
    admin: true,
    body: { chapters },
  });
}

export function registerPurchaser({ name, email }) {
  return api('/api/v1/users/register', {
    method: 'POST',
    admin: true,
    body: { name, email },
  });
}

export function verifyUser(userId) {
  return api(`/api/v1/users/${userId}`);
}

export function updateUser(userId, { name, email }) {
  return api(`/api/v1/users/${userId}`, {
    method: 'PATCH',
    body: { name, email },
  });
}

export function linkPartner({ partnerName, partnerEmail, purchaserUserId, purchaserEmail, token }) {
  return api('/api/v1/partners/link', {
    method: 'POST',
    admin: !token,
    token,
    body: { partnerName, partnerEmail, purchaserUserId, purchaserEmail },
  });
}

export function login(email) {
  return api('/api/v1/users/login', {
    method: 'POST',
    body: { email },
  });
}

export function getCourse(userId) {
  return api(`/api/v1/course/sync?userId=${encodeURIComponent(userId)}`);
}

export function syncStatus(userId) {
  return api(`/api/v1/status/sync?userId=${encodeURIComponent(userId)}`);
}

export function getPartnerProgress(purchaserEmail) {
  return api(`/api/v1/progress/partner?purchaserEmail=${encodeURIComponent(purchaserEmail)}`);
}

export function updateChapterProgress(userId, chapters) {
  return api('/api/v1/chapters/progress', {
    method: 'POST',
    body: { userId, chapters },
  });
}

async function main() {
  const purchaser = { name: 'John Doe', email: 'john@example.com' };
  const partner = { name: 'Jane Doe', email: 'jane@example.com' };

  const chapters = await syncChapters();
  console.log('chapters', chapters.message, chapters.data);

  const registered = await registerPurchaser(purchaser);
  const purchaserId = registered.data.user.id;
  const purchaserToken = registered.data.token;
  console.log('purchaser', purchaserId, registered.data.user.email);

  const role = await verifyUser(purchaserId);
  console.log('role', role.data);

  const linked = await linkPartner({
    partnerName: partner.name,
    partnerEmail: partner.email,
    purchaserUserId: purchaserId,
    token: purchaserToken,
  });
  console.log('partner linked', linked.data);

  const partnerLogin = await login(partner.email);
  console.log('partner user', partnerLogin.data.user.id, partnerLogin.data.user.email);

  const course = await getCourse(purchaserId);
  console.log('course', course.user?.email, course.partner?.email || course.partner);

  const progress = await updateChapterProgress(purchaserId, [
    { chapterName: 'Week 1 Chapter 1', completed: true },
  ]);
  console.log('progress', progress.data);

  const partnerProgress = await getPartnerProgress(purchaser.email);
  console.log('partner progress', partnerProgress.data?.partner?.email || partnerProgress.data);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.status || '', error.message);
    if (error.body) console.error(JSON.stringify(error.body, null, 2));
    process.exit(1);
  });
}
