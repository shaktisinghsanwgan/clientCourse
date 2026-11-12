import { sendSuccess } from '../utils/response.js';
import { ApiError } from '../utils/errors.js';
import { getCourse, getCourseSync } from '../services/course.service.js';
import { saveWeekRatingContact } from '../services/kajabi-contact.service.js';
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

export async function rateWeek(req, res) {
  const user = await getUserByKajabiId(req.valid.body.kajabiUserId);
  if (user.role !== 'PRIMARY' && user.role !== 'PARTNER') {
    throw new ApiError(403, 'Only a purchaser or partner can rate a week', 'ROLE_NOT_ALLOWED');
  }
  const saved = await saveWeekRatingContact({
    email: user.email,
    kajabiId: user.kajabiUserId,
    role: user.role,
    weekNumber: req.valid.body.weekNumber,
    rating: req.valid.body.rating,
  });
  sendSuccess(res, 200, 'Week rating saved', {
    weekNumber: req.valid.body.weekNumber,
    role: user.role === 'PRIMARY' ? 'purchaser' : 'partner',
    ...saved,
  });
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
