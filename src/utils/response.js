export function sendSuccess(res, statusCode, message, data) {
  const body = { success: true, message };
  if (data !== undefined) {
    body.data = data;
  }
  return res.status(statusCode).json(body);
}

export function toPublicUser(user) {
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    kajabiUserId: user.kajabiUserId,
    offerReference: user.offerReference || null,
  };
}
