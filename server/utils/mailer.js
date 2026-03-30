const nodemailer = require('nodemailer');

let transporter = null;

function isMailerConfigured() {
  return Boolean(process.env.OTP_SMTP_HOST && process.env.OTP_SMTP_USER && process.env.OTP_SMTP_PASS);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isMailerConfigured()) {
    throw new Error('Mailer not configured. Set OTP_SMTP_HOST, OTP_SMTP_USER and OTP_SMTP_PASS.');
  }

  transporter = nodemailer.createTransport({
    host: process.env.OTP_SMTP_HOST,
    port: Number(process.env.OTP_SMTP_PORT || 587),
    secure: Number(process.env.OTP_SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.OTP_SMTP_USER,
      pass: process.env.OTP_SMTP_PASS
    }
  });

  return transporter;
}

async function sendSystemEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'missing_recipient' };
  if (!subject || (!text && !html)) return { sent: false, reason: 'invalid_payload' };
  if (!isMailerConfigured()) return { sent: false, reason: 'mailer_not_configured' };

  const from = process.env.OTP_FROM_EMAIL || process.env.OTP_SMTP_USER;
  const tx = getTransporter();

  await tx.sendMail({
    from,
    to,
    subject,
    text: text || '',
    html: html || undefined
  });

  return { sent: true };
}

module.exports = {
  isMailerConfigured,
  sendSystemEmail
};
