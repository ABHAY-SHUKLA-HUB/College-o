const https = require('https');
const net = require('net');
const dns = require('dns').promises;
const nodemailer = require('nodemailer');

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const GMAIL_SMTP_PORT = 587;
const SMTP_VERIFY_ATTEMPTS = 3;
const SMTP_VERIFY_BACKOFF_MS = [1000, 2000, 4000];

let transporter = null;
let startupVerificationPromise = null;
let activeProvider = 'gmail_smtp';

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
  return String(process.env.OTP_SMTP_PASS || '').replace(/\s+/g, '').trim();
}

function getMailFrom() {
  return String(process.env.OTP_FROM_EMAIL || '').trim();
}

function getOtpTestEmail() {
  return String(process.env.OTP_TEST_EMAIL || '').trim();
}

function getResendApiKey() {
  return String(process.env.OTP_RESEND_API_KEY || process.env.RESEND_API_KEY || '').trim();
}

function getResendFromEmail() {
  return String(process.env.OTP_RESEND_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || getMailFrom() || '').trim();
}

function hasResendFallback() {
  return Boolean(getResendApiKey() && getResendFromEmail() && getOtpTestEmail());
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

function getOptionalFallbackVars() {
  return [
    ['OTP_RESEND_API_KEY', getResendApiKey()],
    ['OTP_RESEND_FROM_EMAIL', getResendFromEmail()]
  ];
}

function validateOtpSmtpEnv() {
  const required = getRequiredOtpSmtpVars().map(([name, value]) => ({
    name,
    present: Boolean(value)
  }));
  const fallback = getOptionalFallbackVars().map(([name, value]) => ({
    name,
    present: Boolean(value)
  }));

  console.log('[Mailer] OTP env status', { required, fallback });

  return {
    valid: required.every((item) => item.present),
    fallbackConfigured: hasResendFallback()
  };
}

function getTransporterOptions() {
  const host = GMAIL_SMTP_HOST;
  const port = GMAIL_SMTP_PORT;
  const user = getSmtpUser();
  const pass = getSmtpPass();

  if (!host || !user || !pass) return null;

  return {
    host,
    port,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
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

  transporter = nodemailer.createTransport(options);
  return transporter;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logGmailDnsLookup() {
  try {
    const results = await dns.lookup(GMAIL_SMTP_HOST, { all: true });
    console.log('[Mailer] DNS lookup for smtp.gmail.com', {
      addresses: results.map((entry) => ({ address: entry.address, family: entry.family }))
    });
    return { ok: true, results };
  } catch (error) {
    console.warn('[Mailer] DNS lookup for smtp.gmail.com failed', {
      code: error?.code,
      message: error?.message
    });
    return { ok: false, error };
  }
}

async function probeTcpConnection() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: GMAIL_SMTP_HOST, port: GMAIL_SMTP_PORT });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(30000);

    socket.once('connect', () => {
      console.log('[Mailer] TCP connection to smtp.gmail.com:587 succeeded');
      finish({ ok: true });
    });

    socket.once('timeout', () => {
      const error = Object.assign(new Error('TCP connection timeout'), { code: 'ETIMEDOUT' });
      console.warn('[Mailer] TCP connection to smtp.gmail.com:587 failed', {
        code: error.code,
        message: error.message
      });
      finish({ ok: false, error });
    });

    socket.once('error', (error) => {
      console.warn('[Mailer] TCP connection to smtp.gmail.com:587 failed', {
        code: error?.code,
        message: error?.message
      });
      finish({ ok: false, error });
    });
  });
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

function isConnectivityError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || /timeout|refused|unreachable|eai_again|network/.test(message);
}

async function verifyTransporterWithRetry(transporterInstance) {
  let lastError = null;

  for (let attempt = 1; attempt <= SMTP_VERIFY_ATTEMPTS; attempt += 1) {
    try {
      await transporterInstance.verify();
      return { ok: true };
    } catch (error) {
      lastError = error;
      logMailerError(`[Mailer] SMTP verification attempt ${attempt} failed`, error);
      if (attempt < SMTP_VERIFY_ATTEMPTS) {
        await delay(SMTP_VERIFY_BACKOFF_MS[attempt - 1] || SMTP_VERIFY_BACKOFF_MS[SMTP_VERIFY_BACKOFF_MS.length - 1]);
      }
    }
  }

  return { ok: false, error: lastError };
}

function getMailerFailureReason(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  const response = String(error?.response || '').toLowerCase();
  const combined = `${message} ${response}`;

  if (!isMailerConfigured()) return 'config missing';
  if (code === 'EAUTH' || /auth|credentials|username or password not accepted/.test(combined)) return 'SMTP auth failed';
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ESOCKET' || /timeout|timed out|refused/.test(combined)) return 'SMTP unreachable';
  if (/blocked|not permitted|relay denied|sender address rejected|mail from|provider/.test(combined)) return 'provider blocked';
  return 'provider blocked';
}

async function sendViaResend({ to, from, subject, text, html }) {
  const apiKey = getResendApiKey();
  const resendFrom = getResendFromEmail();

  if (!apiKey || !resendFrom) {
    return { sent: false, reason: 'config missing' };
  }

  const payload = JSON.stringify({
    from: resendFrom,
    to,
    subject,
    text: text || '',
    html: html || undefined
  });

  return await new Promise((resolve) => {
    const request = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30000
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ sent: true, provider: 'resend_api' });
            return;
          }

          const error = new Error(`Resend API request failed (${response.statusCode || 'unknown'})`);
          error.code = `RESEND_${response.statusCode || 'ERROR'}`;
          error.response = body;
          console.warn('[Mailer] Resend API request failed', {
            code: error.code,
            message: error.message,
            response: body
          });
          resolve({ sent: false, reason: 'provider blocked', error });
        });
      }
    );

    request.on('timeout', () => {
      const error = new Error('Resend API request timeout');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });

    request.on('error', (error) => {
      console.warn('[Mailer] Resend API request failed', {
        code: error?.code,
        message: error?.message
      });
      resolve({ sent: false, reason: 'provider blocked', error });
    });

    request.write(payload);
    request.end();
  });
}

async function initMailerTransporter() {
  if (startupVerificationPromise) return startupVerificationPromise;

  startupVerificationPromise = (async () => {
    validateOtpSmtpEnv();

    if (!isMailerConfigured()) {
      if (hasResendFallback()) {
        activeProvider = 'resend_api';
        console.log('[Mailer] Gmail SMTP config missing, using Resend API fallback');
        return null;
      }
      throw new Error('Mailer not configured. Set OTP_SMTP_HOST, OTP_SMTP_USER and OTP_SMTP_PASS.');
    }

    await logGmailDnsLookup();
    const tcpProbe = await probeTcpConnection();
    const tx = getTransporter();
    const verification = await verifyTransporterWithRetry(tx);

    if (verification.ok) {
      activeProvider = 'gmail_smtp';
      console.log('[Mailer] SMTP connected successfully');
      return tx;
    }

    const verificationError = verification.error || tcpProbe.error;
    if (isConnectivityError(verificationError) && hasResendFallback()) {
      activeProvider = 'resend_api';
      console.warn('[Mailer] Gmail SMTP unreachable, falling back to Resend API');
      return null;
    }

    activeProvider = 'gmail_smtp';
    return null;
  })().catch((error) => {
    console.warn('[Mailer] OTP transporter setup failed', {
      code: error?.code,
      message: error?.message
    });
    return null;
  });

  return startupVerificationPromise;
}

async function sendSystemEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'missing_recipient' };
  if (!subject || (!text && !html)) return { sent: false, reason: 'invalid_payload' };

  const from = getMailFrom();
  if (!from) return { sent: false, reason: 'config missing' };

  if (activeProvider === 'resend_api') {
    return await sendViaResend({ to, from, subject, text, html });
  }

  if (!isMailerConfigured()) {
    if (hasResendFallback()) {
      activeProvider = 'resend_api';
      return await sendViaResend({ to, from, subject, text, html });
    }
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
    return { sent: true, provider: 'gmail_smtp' };
  } catch (error) {
    logMailerError('OTP email failed:', error);

    if (isConnectivityError(error) && hasResendFallback()) {
      console.warn('[Mailer] Gmail SMTP unreachable during send, falling back to Resend API');
      activeProvider = 'resend_api';
      return await sendViaResend({ to, from, subject, text, html });
    }

    return { sent: false, reason: getMailerFailureReason(error), error };
  }
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
