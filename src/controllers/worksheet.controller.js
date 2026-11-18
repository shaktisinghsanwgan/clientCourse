import { sendSuccess } from '../utils/response.js';
import { participantFromToken } from '../services/portal-link.service.js';
import {
  buildPortalState,
  deleteWorksheetFile,
  saveChecklistItem,
  saveRatingDraft,
  saveWorksheetUpload,
  sendWorksheetFile,
  submitWeekRating,
  weekState,
  worksheetFileForParticipant,
} from '../services/worksheet.service.js';

async function participant(req) {
  return participantFromToken(req.valid.params.token);
}

export async function showPortal(req, res) {
  sendSuccess(res, 200, 'Worksheet portal', await buildPortalState(await participant(req)));
}

export async function showWeek(req, res) {
  const user = await participant(req);
  sendSuccess(res, 200, 'Week worksheet', await weekState(user, req.valid.params.weekNumber));
}

export async function draftRating(req, res) {
  const user = await participant(req);
  sendSuccess(res, 200, 'Progress saved', await saveRatingDraft(user, req.valid.body));
}

export async function submitRating(req, res) {
  const user = await participant(req);
  sendSuccess(res, 200, 'Week submitted', await submitWeekRating(user, req.valid.body));
}

export async function updateChecklist(req, res) {
  const user = await participant(req);
  sendSuccess(res, 200, 'Checklist saved', await saveChecklistItem(user, req.valid.body));
}

export async function uploadWorksheet(req, res) {
  const user = await participant(req);
  sendSuccess(res, 200, 'Worksheet uploaded', await saveWorksheetUpload(user, req.valid.body, req.file));
}

export async function downloadWorksheet(req, res) {
  const user = await participant(req);
  sendWorksheetFile(res, await worksheetFileForParticipant(user, req.valid.params.fileId));
}

export async function removeWorksheet(req, res) {
  const user = await participant(req);
  sendSuccess(res, 200, 'Worksheet deleted', await deleteWorksheetFile(user, req.valid.params.fileId));
}
