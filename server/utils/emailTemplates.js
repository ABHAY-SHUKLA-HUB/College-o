function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function renderLayout({ eyebrow = 'College OS', title, subtitle = '', bodyHtml = '', ctaLabel = '', ctaUrl = '', footerNote = '' }) {
  const safeTitle = escapeHtml(title || 'Update from College OS');
  const safeSubtitle = escapeHtml(subtitle || '');
  const safeFooter = escapeHtml(footerNote || 'This is an automated message from College OS.');

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${safeTitle}</title>
    </head>
    <body style="margin:0; padding:0; background:#f3f7fb; font-family:Segoe UI, -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif; color:#1f2f3f;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb; padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; background:#ffffff; border:1px solid #d9e6f2; border-radius:14px; overflow:hidden;">
              <tr>
                <td style="background:linear-gradient(135deg,#1f3b59,#2d5f88); color:#ffffff; padding:22px 26px;">
                  <div style="font-size:12px; letter-spacing:.14em; text-transform:uppercase; opacity:.88;">${escapeHtml(eyebrow)}</div>
                  <div style="font-size:26px; font-weight:700; margin-top:6px;">College OS</div>
                  <div style="font-size:14px; opacity:.9; margin-top:6px;">Student ecosystem operations, trust, and growth.</div>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 26px 8px 26px;">
                  <h1 style="margin:0; font-size:23px; line-height:1.35; color:#1f2f3f;">${safeTitle}</h1>
                  ${safeSubtitle ? `<p style="margin:10px 0 0; color:#4b6075; font-size:14px; line-height:1.55;">${safeSubtitle}</p>` : ''}
                </td>
              </tr>
              <tr>
                <td style="padding:14px 26px 8px 26px; color:#2e4459; font-size:14px; line-height:1.62;">
                  ${bodyHtml}
                </td>
              </tr>
              ${ctaLabel && ctaUrl ? `
              <tr>
                <td style="padding:18px 26px 24px 26px;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:inline-block; background:#1f5f9b; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:11px 18px; border-radius:9px;">${escapeHtml(ctaLabel)}</a>
                </td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding:16px 26px 20px 26px; border-top:1px solid #e4edf6; color:#6a7f93; font-size:12px; line-height:1.6; background:#fafcff;">
                  ${safeFooter}<br/>
                  College OS · India
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;
}

function buildOtpEmail({ otp, purpose = 'signup', channel = 'email', target = '', expiresMinutes = 5 }) {
  const purposeText = purpose === 'login' ? 'sign in' : purpose === 'password_reset' ? 'reset your password' : 'verify your account';
  return {
    subject: `College OS Verification Code - ${String(otp || '').slice(0, 6)}`,
    text: `Your College OS OTP is ${otp}. It expires in ${expiresMinutes} minutes. Requested for ${purposeText} via ${channel} (${target}).`,
    html: renderLayout({
      eyebrow: 'Account Verification',
      title: 'Your secure verification code',
      subtitle: `Use this one-time code to ${purposeText}.`,
      bodyHtml: `
        <p style="margin:0 0 12px;">Enter this code in your College OS screen:</p>
        <div style="display:inline-block; font-size:30px; letter-spacing:.24em; font-weight:700; color:#173a5c; background:#eff6ff; border:1px solid #d3e5fb; border-radius:10px; padding:12px 18px;">${escapeHtml(otp)}</div>
        <p style="margin:14px 0 0;">This OTP expires in <strong>${escapeHtml(expiresMinutes)}</strong> minutes.</p>
        <p style="margin:8px 0 0; color:#5f748a; font-size:13px;">Request context: ${escapeHtml(channel)} / ${escapeHtml(target)}.</p>
      `,
      footerNote: 'Never share this OTP with anyone, including support representatives.'
    })
  };
}

function buildPasswordResetEmail({ resetUrl, expiresMinutes = 15, supportEmail = 'support@collegeos.in' }) {
  return {
    subject: 'College OS Password Reset Request',
    text: `A password reset was requested for your College OS account. Use this secure link within ${expiresMinutes} minutes: ${resetUrl} If you did not request this, contact ${supportEmail}.`,
    html: renderLayout({
      eyebrow: 'Account Security',
      title: 'Reset your College OS password',
      subtitle: 'A password reset request was received for your account.',
      bodyHtml: `
        <p style="margin:0 0 12px;">If this request was made by you, continue using the secure reset link below.</p>
        <p style="margin:0; color:#5f748a;">The link expires in ${escapeHtml(expiresMinutes)} minutes and can be used only once.</p>
        <p style="margin:10px 0 0; color:#5f748a;">Need help? Contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#1f6feb;">${escapeHtml(supportEmail)}</a>.</p>
      `,
      ctaLabel: 'Reset Password',
      ctaUrl: resetUrl,
      footerNote: 'If you did not request this, you can safely ignore this email.'
    })
  };
}

function buildNotificationEmail({ kind, title, message, ctaUrl }) {
  const safeKind = String(kind || '').toLowerCase();
  let subject = 'College OS Update';

  if (safeKind.includes('approved')) subject = 'Your post is now live on College OS';
  else if (safeKind.includes('rejected')) subject = 'Your post was reviewed by College OS moderation';
  else if (safeKind.includes('points')) subject = 'Your College OS creator points were updated';
  else if (safeKind.includes('featured')) subject = 'Your post was featured on College OS';

  return {
    subject,
    text: `${title}. ${message}`,
    html: renderLayout({
      eyebrow: 'Campus Feed Notification',
      title: title || 'You have a new College OS update',
      subtitle: 'Moderation and trust operations update.',
      bodyHtml: `<p style="margin:0;">${escapeHtml(message || '')}</p>`,
      ctaLabel: ctaUrl ? 'Open College OS' : '',
      ctaUrl: ctaUrl || '',
      footerNote: 'This notification reflects your current moderation and creator status.'
    })
  };
}

module.exports = {
  buildOtpEmail,
  buildPasswordResetEmail,
  buildNotificationEmail
};
