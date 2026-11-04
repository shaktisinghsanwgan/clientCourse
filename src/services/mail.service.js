import { env } from '../config/env.js';

export function isMailConfigured() {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM && env.CLIENT_EMAIL);
}

async function sendEmail({ subject, text }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [env.CLIENT_EMAIL],
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed (${response.status}): ${body}`);
  }
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

  await sendEmail({ subject, text });
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

  await sendEmail({ subject, text });
  return { delivered: true };
}
