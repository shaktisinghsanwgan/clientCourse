import { sendSuccess } from '../utils/response.js';
import { getMyPartnership, getPartnerProgress, linkPartner } from '../services/partner.service.js';

export async function link(req, res) {
  const actor = req.admin ? null : req.user;
  const result = await linkPartner(actor, req.valid.body);
  sendSuccess(res, 200, 'Partner linked', result);
}

export async function me(req, res) {
  const result = await getMyPartnership(req.user);
  sendSuccess(res, 200, 'Partner details', result);
}

export async function progress(req, res) {
  const result = await getPartnerProgress(req.user);
  sendSuccess(res, 200, 'Partner progress', result);
}
