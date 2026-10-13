import { sendSuccess } from '../utils/response.js';
import {
  getProfile,
  loginByEmail,
  registerPurchaser,
  syncAuthenticatedUser,
  bindKajabiIdentity,
  updateUserAccount,
  verifyByKajabiUserId,
  verifyUserRole,
} from '../services/user.service.js';

export async function register(req, res) {
  const result = await registerPurchaser(req.valid.body);
  sendSuccess(res, result.created ? 201 : 200, 'Purchaser registered', result);
}

export async function syncUser(req, res) {
  const result = await syncAuthenticatedUser(req.user, req.valid.body);
  sendSuccess(res, 200, 'Kajabi identity synchronized', result);
}

export async function me(req, res) {
  sendSuccess(res, 200, 'Authenticated user', getProfile(req.user));
}

export async function login(req, res) {
  const result = await loginByEmail(req.valid.body.email);
  sendSuccess(res, 200, 'Signed in', result);
}

export async function lookup(req, res) {
  const result = await verifyByKajabiUserId(req.valid.query.kajabiUserId);
  const message = result.isPurchaser ? 'Purchaser' : 'Partner';
  sendSuccess(res, 200, message, result);
}

export async function bind(req, res) {
  const result = await bindKajabiIdentity(req.valid.body);
  const message = result.isPurchaser ? 'Purchaser linked' : 'Partner linked';
  sendSuccess(res, 200, message, result);
}

export async function verify(req, res) {
  const result = await verifyUserRole(req.valid.params.userId);
  const message = result.isPurchaser ? 'Purchaser' : 'Partner';
  sendSuccess(res, 200, message, result);
}

export async function update(req, res) {
  const result = await updateUserAccount(req.valid.params.userId, req.valid.body);
  sendSuccess(res, 200, 'User updated', result);
}
