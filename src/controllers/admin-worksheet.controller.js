import { ApiError } from '../utils/errors.js';
import { sendSuccess } from '../utils/response.js';
import { publicBaseUrl, syncAllPortalLinks } from '../services/portal-link.service.js';
import {
  adminParticipantDetail,
  adminWorksheetFile,
  listAdminParticipants,
  sendWorksheetFile,
} from '../services/worksheet.service.js';

export async function listParticipants(req, res) {
  sendSuccess(res, 200, 'Participants', await listAdminParticipants());
}

export async function showParticipant(req, res) {
  sendSuccess(res, 200, 'Participant', await adminParticipantDetail(req.valid.params.participantId));
}

export async function showParticipantRatings(req, res) {
  const detail = await adminParticipantDetail(req.valid.params.participantId);
  sendSuccess(res, 200, 'Participant ratings', {
    purchaser: detail.purchaser
      ? { profile: detail.purchaser.profile, ratings: detail.purchaser.ratings }
      : null,
    partner: detail.partner
      ? { profile: detail.partner.profile, ratings: detail.partner.ratings }
      : null,
  });
}

export async function showParticipantWorksheets(req, res) {
  const detail = await adminParticipantDetail(req.valid.params.participantId);
  sendSuccess(res, 200, 'Participant worksheets', {
    purchaser: detail.purchaser
      ? { profile: detail.purchaser.profile, weeks: detail.purchaser.weeks }
      : null,
    partner: detail.partner
      ? { profile: detail.partner.profile, weeks: detail.partner.weeks }
      : null,
  });
}

export async function downloadParticipantWorksheet(req, res) {
  const file = await adminWorksheetFile(req.valid.params.participantId, req.valid.params.fileId);
  sendWorksheetFile(res, file);
}

export async function syncPortalLinks(req, res) {
  const baseUrl = publicBaseUrl(req);
  if (!baseUrl || baseUrl === '://') {
    throw new ApiError(500, 'APP_BASE_URL is required to publish portal links', 'APP_BASE_URL_MISSING');
  }
  sendSuccess(res, 200, 'Portal links synced', await syncAllPortalLinks(baseUrl));
}
