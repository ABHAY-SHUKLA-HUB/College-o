const { Resend } = require('resend');

const DEFAULT_EMAIL_PROVIDER = 'resend';
const DEFAULT_EMAIL_FROM = 'College OS <noreply@collegeo.in>';

let nodemailer = null;
let transporter = null;
let resendClient = null;
let activeProvider = null;

function getMailFrom() {
  return String(process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM).trim() || DEFAULT_EMAIL_FROM;
}

function getOtpTestEmail() {
  return String(process.env.OTP_TEST_EMAIL || '').trim();
}

function getEmailProvider() {
  return String(process.env.OTP_EMAIL_PROVIDER || '').trim().toLowerCase();
}

function getResendApiKey() {
  return String(process.env.RESEND_API_KEY || '').trim();
}

function getResendFromEmail() {
  const configured = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!configured) return DEFAULT_EMAIL_FROM;
  return configured.includes('<') ? configured : `Collegeo <${configured}>`;
}

function getSmtpUser() {
  return String(process.env.OTP_SMTP_USER || '').trim();
}

function getSmtpPass() {
  return String(process.env.OTP_SMTP_PASS || '').replace(/\s+/g, '').trim();
}

function hasResendFallback() {
  return Boolean(getResendApiKey() && getResendFromEmail() && getOtpTestEmail());
}

function resolveEmailProvider() {
  const explicit = getEmailProvider();
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (explicit === 'resend' || explicit === 'smtp') {
    return explicit;
  }

  if (isProduction) {
    return 'resend';
  }

  if (hasResendFallback()) {
    return 'resend';
  }

  if (getSmtpUser() && getSmtpPass()) {
    return 'smtp';
  }

  return DEFAULT_EMAIL_PROVIDER;
}

function logProviderSelection(provider, source) {
  console.log('[Mailer] email provider selected', { provider, source });
}

function logResendStartupStatus() {
  console.log('[Mailer] Active provider: resend');
  console.log('[Mailer] Resend API key present:', Boolean(getResendApiKey()));
  console.log('[Mailer] RESEND_FROM_EMAIL configured:', Boolean(String(process.env.RESEND_FROM_EMAIL || '').trim()));
  console.log('[Mailer] Resend from email:', getResendFromEmail() || DEFAULT_EMAIL_FROM);
}

function logSmtpStartupStatus() {
  console.log('[Mailer] Active provider: smtp');
  console.log('[Mailer] SMTP user present:', Boolean(getSmtpUser()));
  console.log('[Mailer] SMTP host present:', Boolean(String(process.env.OTP_SMTP_HOST || '').trim()));
}

function getTransporterOptions() {
  const host = String(process.env.OTP_SMTP_HOST || 'smtp.gmail.com').trim();
  const rawPort = process.env.OTP_SMTP_PORT || 587;
  const port = Number(rawPort);
  const user = String(process.env.OTP_SMTP_USER || '').trim();
  const pass = String(process.env.OTP_SMTP_PASS || '').replace(/\s+/g, '').trim();

  if (!host || !user || !pass) return null;

  return {
    host,
    port,
    secure: false,
    requireTLS: true,
    servername: 'smtp.gmail.com',
    auth: { user, pass },
    lookup: (hostname, options, callback) => {
      const dns = require('dns');
      return dns.lookup(hostname, { family: 4 }, callback);
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    }
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

  if (!nodemailer) {
    nodemailer = require('nodemailer');
  }
  transporter = nodemailer.createTransport(options);
  return transporter;
}

function logMailerError(prefix, error) {
  console.error(prefix, { message: error?.message, code: error?.code });
}

function isLikelyResendSenderRejection(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return /sender|from|domain|verify|verification|authorized|unauthorized/.test(message)
    || /sender|domain|from/.test(code);
}

function getResendClient() {
  if (resendClient) return resendClient;
  const apiKey = getResendApiKey();
  if (!apiKey) return null;
  resendClient = new Resend(apiKey);
  return resendClient;
}

async function sendViaResend({ to, subject, text, html }) {
  const resendFrom = getResendFromEmail();
  const client = getResendClient();

  if (!client || !resendFrom) {
    return { sent: false, reason: 'config missing' };
  }

  try {
    const result = await client.emails.send({
      from: resendFrom,
      to,
      subject,
      text: text || '',
      html: html || undefined
    });

    return { sent: true, provider: 'resend', id: result?.data?.id || null };
  } catch (error) {
    if (isLikelyResendSenderRejection(error)) {
      console.error('[Mailer][Resend] sender rejected or domain not verified', {
        from: resendFrom,
        hint: 'Set RESEND_FROM_EMAIL to a Resend-verified sender like Collegeo <noreply@collegeo.in> and verify collegeo.in in Resend.',
        message: error?.message,
        code: error?.code
      });
    }
    return { sent: false, reason: 'provider blocked', error };
  }
}

async function initMailerTransporter() {
  const provider = resolveEmailProvider();
  activeProvider = provider;
  logProviderSelection(provider, 'startup');

  if (provider === 'resend') {
    logResendStartupStatus();
    return provider;
  }

  if (provider === 'smtp') {
    logSmtpStartupStatus();
    return provider;
  }

  return provider;
}

async function sendSystemEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'missing_recipient' };
  if (!subject || (!text && !html)) return { sent: false, reason: 'invalid_payload' };

  const provider = activeProvider || resolveEmailProvider();
  const from = provider === 'resend' ? getResendFromEmail() : getMailFrom();

  if (!from) return { sent: false, reason: 'config missing' };

  if (provider === 'resend') {
    const result = await sendViaResend({ to, subject, text, html });
    if (result.sent) {
      console.log('[Mailer] email sent successfully', { provider: 'resend' });
      return result;
    }
    console.warn('[Mailer] send failed', { provider: 'resend', from, reason: result?.reason || 'provider blocked' });
    return result;
  }

  if (provider === 'smtp') {
    if (!isMailerConfigured()) {
      return { sent: false, reason: 'config missing' };
    }

    const tx = getTransporter();

    try {
      await tx.sendMail({
        from,
        to,
        subject,
        text: text || '',
        html: html || undefined
      });
      console.log('[Mailer] email sent successfully', { provider: 'smtp' });
      return { sent: true, provider: 'smtp' };
    } catch (error) {
      logMailerError('[Mailer] send failed', error);
      return { sent: false, reason: 'provider blocked', error };
    }
  }

  return { sent: false, reason: 'config missing' };
}

module.exports = {
  isMailerConfigured,
  getMailFrom,
  getOtpTestEmail,
  getTransporter,
  initMailerTransporter,
  resolveEmailProvider,
  sendSystemEmail
};
