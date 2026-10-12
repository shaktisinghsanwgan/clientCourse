import { getCourse, getCourseSync } from '../services/course.service.js';
import { getPartnerProgressByPurchaserEmail } from '../services/progress.service.js';
import { getUserById } from '../services/user.service.js';

export async function showCourse(req, res) {
  const purchaserEmail = req.valid?.query?.purchaserEmail;
  const userId = req.valid?.query?.userId;
  if (userId) {
    const user = await getUserById(userId);
    const result = await getCourseSync(user);
    res.json(result);
    return;
  }
  if (purchaserEmail) {
    const result = await getPartnerProgressByPurchaserEmail(purchaserEmail);
    res.json({ success: true, message: 'Partner progress', data: result });
    return;
  }
  const result = await getCourse(req.user);
  res.json({ success: true, message: 'Course structure', data: result });
}

export async function syncCourse(req, res) {
  const purchaserEmail = req.valid?.query?.purchaserEmail;
  const userId = req.valid?.query?.userId;
  if (userId) {
    const user = await getUserById(userId);
    const result = await getCourseSync(user);
    res.json(result);
    return;
  }
  if (purchaserEmail) {
    const result = await getPartnerProgressByPurchaserEmail(purchaserEmail);
    res.json({ success: true, message: 'Partner progress', data: result });
    return;
  }
  const result = await getCourseSync(req.user);
  res.json(result);
}
