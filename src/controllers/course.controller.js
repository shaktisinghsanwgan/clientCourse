import { getCourse, getCourseSync } from '../services/course.service.js';
import { getPartnerProgressByPurchaserEmail } from '../services/progress.service.js';
import { getUserById, getUserByKajabiId } from '../services/user.service.js';

export async function showCourse(req, res) {
  const synced = await courseForQuery(req);
  if (synced) {
    res.json(synced);
    return;
  }
  const result = await getCourse(req.user);
  res.json({ success: true, message: 'Course structure', data: result });
}

export async function syncCourse(req, res) {
  const synced = await courseForQuery(req);
  if (synced) {
    res.json(synced);
    return;
  }
  const result = await getCourseSync(req.user);
  res.json(result);
}

async function courseForQuery(req) {
  const purchaserEmail = req.valid?.query?.purchaserEmail;
  const userId = req.valid?.query?.userId;
  const kajabiUserId = req.valid?.query?.kajabiUserId;
  if (userId) {
    return getCourseSync(await getUserById(userId));
  }
  if (kajabiUserId) {
    return getCourseSync(await getUserByKajabiId(kajabiUserId));
  }
  if (purchaserEmail) {
    const result = await getPartnerProgressByPurchaserEmail(purchaserEmail);
    return { success: true, message: 'Partner progress', data: result };
  }
  return null;
}
