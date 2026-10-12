import { sendSuccess } from '../utils/response.js';
import {
  completeChapter,
  createChapter,
  updateProgressByChapterNames,
  listWeekChapters,
  setChapterActive,
  syncChapters,
  updateChapter,
} from '../services/chapter.service.js';

export async function create(req, res) {
  const result = await createChapter(req.valid.body);
  sendSuccess(res, 201, 'Chapter created', result);
}

export async function update(req, res) {
  const result = await updateChapter(req.valid.params.chapterId, req.valid.body);
  sendSuccess(res, 200, 'Chapter updated', result);
}

export async function setActive(req, res) {
  const result = await setChapterActive(req.valid.params.chapterId, req.valid.body.isActive);
  sendSuccess(res, 200, result.isActive ? 'Chapter activated' : 'Chapter deactivated', result);
}

export async function sync(req, res) {
  const result = await syncChapters(req.valid.body.chapters);
  sendSuccess(res, 200, 'Chapter structure synchronized', result);
}

export async function week(req, res) {
  const result = await listWeekChapters(req.user, req.valid.params.weekNumber);
  sendSuccess(res, 200, 'Week chapters', result);
}

export async function progressByName(req, res) {
  const result = await updateProgressByChapterNames(req.valid.body.userId, req.valid.body.chapters);
  sendSuccess(res, 200, 'Chapter progress updated', result);
}

export async function complete(req, res) {
  const result = await completeChapter(req.user, req.valid.body.chapterId, req.valid.body.completed);
  const message = req.valid.body.completed
    ? 'Chapter completed successfully'
    : 'Chapter marked incomplete';
  sendSuccess(res, 200, message, result);
}
