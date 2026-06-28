const nodemailer = require('nodemailer');

let transporter = null;
let startupVerificationPromise = null;

function getSmtpHost() {
  return String(process.env.OTP_SMTP_HOST || '').trim();
}

function getSmtpPort() {
  const raw = process.env.OTP_SMTP_PORT || 587;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : 587;
}

function getSmtpUser() {
  return String(process.env.OTP_SMTP_USER || '').trim();
}

function getSmtpPass() {
  return String(process.env.OTP_SMTP_PASS || '').trim();
}

function getMailFrom() {
  return String(process.env.OTP_FROM_EMAIL || '').trim();
}

function getOtpTestEmail() {
  return String(process.env.OTP_TEST_EMAIL || '').trim();
}

function getRequiredOtpSmtpVars() {
  return [
    ['OTP_SMTP_HOST', getSmtpHost()],
    ['OTP_SMTP_PORT', String(process.env.OTP_SMTP_PORT || '').trim()],
    ['OTP_SMTP_USER', getSmtpUser()],
    ['OTP_SMTP_PASS', getSmtpPass()],
    ['OTP_FROM_EMAIL', getMailFrom()],
    ['OTP_TEST_EMAIL', getOtpTestEmail()]
  ];
}

function validateOtpSmtpEnv() {
  const summary = getRequiredOtpSmtpVars().map(([name, value]) => ({
    name,
    present: Boolean(value)
  }));

  console.log('[Mailer] OTP env status', summary);

  return {
    valid: summary.every((item) => item.present),
    summary
  };
}

function getTransporterOptions() {
  const host = getSmtpHost();
  const port = getSmtpPort();
  const user = getSmtpUser();
  const pass = getSmtpPass();

  if (!host || !user || !pass) return null;

  return {
    host,
    port,
    secure: false,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 20_000
  };
}

function isMailerConfigured() {
  return Boolean(getTransporterOptions());
}

function getTransporter() {
  if (transporter) return transporter;
  const options = getTransporterOptions();
  if (!options) {
    throw new Error('Mailer not configured. Set OTP_SMTP_HOST, OTP_SMTP_USER and OTP_SMTP_PASS.');
  }

  transporter = nodemailer.createTransport(options);

  return transporter;
}

async function initMailerTransporter() {
  const tx = getTransporter();
  if (!startupVerificationPromise) {
    startupVerificationPromise = tx.verify()
      .then(() => {
        console.log('[Mailer] SMTP connected successfully');
        return tx;
      })
      .catch((error) => {
        console.warn('[Mailer] SMTP verification failed', {
          code: error?.code,
          message: error?.message
        });
        return null;
      });
  }
  return startupVerificationPromise;
}

function getMailerFailureReason(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  const response = String(error?.response || '').toLowerCase();
  const combined = `${message} ${response}`;

  if (!isMailerConfigured()) return 'config missing';
  if (code === 'EAUTH' || /auth|credentials|username or password not accepted/.test(combined)) return 'SMTP auth failed';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout|timed out/.test(combined)) return 'timeout';
  if (/blocked|not permitted|relay denied|sender address rejected|mail from|provider/.test(combined)) return 'provider blocked';
  return 'provider blocked';
}

function logMailerError(prefix, error) {
  console.error(prefix, {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    command: error?.command,
    response: error?.response
  });
}

async function sendSystemEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'missing_recipient' };
  if (!subject || (!text && !html)) return { sent: false, reason: 'invalid_payload' };
  if (!isMailerConfigured()) return { sent: false, reason: 'config missing' };

  const from = getMailFrom();
  if (!from) return { sent: false, reason: 'config missing' };
  const tx = getTransporter();

  try {
    await tx.sendMail({
      from,
      to,
      subject,
      text: text || '',
      html: html || undefined
    });
  } catch (error) {
    logMailerError('OTP email failed:', error);
    return { sent: false, reason: getMailerFailureReason(error), error };
  }

  return { sent: true };
}

module.exports = {
  isMailerConfigured,
  getMailFrom,
  getOtpTestEmail,
  getTransporter,
  initMailerTransporter,
  validateOtpSmtpEnv,
  getMailerFailureReason,
  sendSystemEmail
};
