import { sendSuccess } from '../utils/response.js';
import {
  getMyProgress,
  getWeekProgress,
  buildPartnerProgress,
  getPartnerProgressByPurchaserEmail,
} from '../services/progress.service.js';

export async function me(req, res) {
  const result = await getMyProgress(req.user);
  sendSuccess(res, 200, 'Your progress', result);
}

export async function partner(req, res) {
  const purchaserEmail = req.valid?.query?.purchaserEmail;
  if (purchaserEmail) {
    const result = await getPartnerProgressByPurchaserEmail(purchaserEmail);
    sendSuccess(res, 200, 'Partner progress', result);
    return;
  }
  const result = await buildPartnerProgress(req.user);
  sendSuccess(res, 200, 'Partner progress', result);
}

export async function week(req, res) {
  const result = await getWeekProgress(req.user, req.valid.params.weekNumber);
  sendSuccess(res, 200, 'Week progress', result);
}
