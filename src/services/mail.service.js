import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transport;

export function isMailConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM && env.CLIENT_EMAIL);
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

export async function sendInactivityEmail({ inactiveUser, inactiveSince, days }) {
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
    `They have been inactive for more than ${days} days.`,
  ].join('\n');

  await mailer().sendMail({
    from: env.SMTP_FROM,
    to: env.CLIENT_EMAIL,
    subject,
    text,
  });

  return { delivered: true };
}

export async function sendMissingPartnerInviteEmail({ purchaser, registeredAt, reminderHours }) {
  if (!isMailConfigured()) {
    return { delivered: false, skipped: true };
  }

  const when = new Date(registeredAt).toISOString();
  const hours = Number(reminderHours) > 0 ? Number(reminderHours) : env.PARTNER_INVITE_REMINDER_HOURS;
  const subject = `${purchaser.name} has not invited a partner`;
  const text = [
    `${purchaser.name} has not invited a partner.`,
    '',
    `${purchaser.name} (${purchaser.email}) checked out at ${when} and still has not sent a partner invite.`,
    `This reminder repeats every ${hours} hours until they invite a partner.`,
  ].join('\n');

  await mailer().sendMail({
    from: env.SMTP_FROM,
    to: env.CLIENT_EMAIL,
    subject,
    text,
  });

  return { delivered: true };
}
