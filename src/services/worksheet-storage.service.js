import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

export function storageRoot() {
  return path.resolve(env.WORKSHEET_STORAGE_DIR || path.join(process.cwd(), 'storage', 'worksheets'));
}

export function resolveStored(relativePath) {
  const root = storageRoot();
  const full = path.resolve(root, String(relativePath || ''));
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new ApiError(404, 'Worksheet not found', 'WORKSHEET_NOT_FOUND');
  }
  return full;
}

export function isPdfUpload(file) {
  const name = String(file?.originalname || '').trim().toLowerCase();
  const type = String(file?.mimetype || '').trim().toLowerCase();
  const buffer = file?.buffer;
  if (!name.endsWith('.pdf')) return false;
  if (type && !['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(type)) {
    return false;
  }
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

export function cleanFilename(name) {
  const base = path.basename(String(name || 'worksheet.pdf')).replace(/[^\w.\- ()]+/g, '');
  const trimmed = (base || 'worksheet.pdf').slice(0, 180);
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

export async function saveWorksheetFile({ userId, weekNumber, worksheetKey, buffer }) {
  const dir = path.join(storageRoot(), String(userId), String(weekNumber));
  await fs.mkdir(dir, { recursive: true });
  const filename = `${worksheetKey}-${crypto.randomBytes(8).toString('hex')}.pdf`;
  const full = path.join(dir, filename);
  await fs.writeFile(full, buffer, { flag: 'wx' });
  return path.relative(storageRoot(), full).split(path.sep).join('/');
}

export async function removeStoredFiles(relativePaths) {
  const paths = Array.isArray(relativePaths) ? relativePaths : [];
  await Promise.all(paths.filter(Boolean).map(async (relativePath) => {
    try {
      await fs.unlink(resolveStored(relativePath));
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.errorCode !== 'WORKSHEET_NOT_FOUND') {
        console.error('Worksheet file cleanup failed', error instanceof Error ? error.message : error);
      }
    }
  }));
}

export async function storedFileExists(relativePath) {
  try {
    await fs.access(resolveStored(relativePath));
    return true;
  } catch {
    return false;
  }
}
