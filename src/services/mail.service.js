import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transport;

export function isMailConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

function mailer() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transport;
}

export async function sendInactivityEmail({ to, inactiveUser, inactiveSince, days }) {
  if (!isMailConfigured()) {
    return { delivered: false, skipped: true };
  }

  const name = inactiveUser.name;
  const when = new Date(inactiveSince).toISOString();
  const subject = `${name} has been inactive for one week`;
  const text = [
    `${name} has been inactive for one week.`,
    '',
    `${name} (${inactiveUser.email}) has not used the course since ${when}.`,
    `This client has been inactive for more than ${days} days.`,
  ].join('\n');

  await mailer().sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text,
  });

  return { delivered: true };
}
