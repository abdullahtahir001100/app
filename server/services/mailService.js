const nodemailer = require('nodemailer');

function envTrim(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

function smtpConfigured() {
  return Boolean(envTrim('SMTP_HOST') && envTrim('SMTP_USER') && envTrim('SMTP_PASS'));
}

function createTransport() {
  const port = Number(envTrim('SMTP_PORT', '587')) || 587;
  const secure =
    envTrim('SMTP_SECURE').toLowerCase() === 'true' ||
    envTrim('SMTP_SECURE') === '1' ||
    port === 465;

  return nodemailer.createTransport({
    host: envTrim('SMTP_HOST', 'smtp.gmail.com'),
    port,
    secure,
    auth: {
      user: envTrim('SMTP_USER'),
      pass: envTrim('SMTP_PASS'),
    },
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appBaseUrl() {
  return envTrim('NEXT_PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
}

function zenvoraLogoHtml(size = 56) {
  const cx = size / 2;
  const rings = [
    { r: size * 0.45, sw: 1.5, op: 0.35 },
    { r: size * 0.35, sw: 1.75, op: 0.65 },
    { r: size * 0.25, sw: 2, op: 0.85 },
  ];
  const dotR = size * 0.08;
  const ringSvg = rings
    .map(
      (ring) =>
        `<circle cx="${cx}" cy="${cx}" r="${ring.r}" fill="none" stroke="#52525b" stroke-width="${ring.sw}" opacity="${ring.op}"/>`
    )
    .join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" valign="middle" width="${size}" height="${size}">
          <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
            ${ringSvg}
            <circle cx="${cx}" cy="${cx}" r="${dotR}" fill="#27272a"/>
          </svg>
        </td>
      </tr>
    </table>`;
}

function buildPasswordResetEmailHtml({ name, otp }) {
  const safeName = escapeHtml(name || 'there');
  const safeOtp = escapeHtml(otp);
  const appUrl = escapeHtml(appBaseUrl());
  const year = new Date().getFullYear();

  // OTP Boxes: #f3f2ef Background + #dcdbd7 border (No Black)
  const digits = safeOtp.split('').map(
    (d) =>
      `<td align="center" valign="middle" style="width:44px;height:52px;background:#f3f2ef;border:1px solid #dcdbd7;font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:700;color:#27272a;letter-spacing:0;">${d}</td>`
  ).join('<td width="6"></td>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>Zenvora Password Reset</title>
</head>
<body style="margin:0;padding:0;background:#f3f2ef;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f2ef;padding:40px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        
        <!-- Header (#f3f2ef styled header, no black) -->
        <tr>
          <td style="background:#f3f2ef;padding:36px 32px;text-align:center;border-bottom:1px solid #dcdbd7;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px;">
              <tr>
                <td align="center">${zenvoraLogoHtml(56)}</td>
              </tr>
            </table>
            <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#27272a;letter-spacing:0.05em;text-transform:uppercase;">Zenvora</p>
            <p style="margin:6px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;color:#71717a;letter-spacing:0.2em;text-transform:uppercase;">Remote Device Control</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px 16px;">
            <p style="margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.15em;">Password Reset</p>
            <h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:22px;line-height:1.3;color:#27272a;font-weight:600;">Hi ${safeName},</h1>
            <p style="margin:0 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#52525b;">
              Use the verification code below to reset your Zenvora account password. This code expires in <strong style="color:#27272a;">10 minutes</strong>.
            </p>

            <!-- OTP Code Display -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 20px;">
              <tr>${digits}</tr>
            </table>

            <!-- Single-Click Copy Code Strip with SVG Icon -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f2ef;border:1px solid #dcdbd7;margin-bottom:20px;">
              <tr>
                <td style="padding:10px 14px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="middle" align="left">
                        <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Copy Code</span>
                      </td>
                      <td valign="middle" align="right">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td valign="middle" style="padding-right:6px;">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" style="display:block;">
                                <rect x="9" y="9" width="13" height="13" fill="none"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                            </td>
                            <td valign="middle">
                              <span style="font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:700;color:#27272a;letter-spacing:2px;-webkit-user-select:all;user-select:all;cursor:pointer;">${safeOtp}</span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Notice Box -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f2ef;border:1px solid #dcdbd7;margin-bottom:8px;">
              <tr>
                <td style="padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.5;color:#52525b;">
                  Enter this code on the verification screen. Never share this code with anyone — Zenvora support will never ask for it.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA Button (#f3f2ef Button style) -->
        <tr>
          <td align="center" style="padding:12px 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:#f3f2ef;border:1px solid #dcdbd7;">
                  <a href="${appUrl}/verify-otp" style="display:block;background:#f3f2ef;color:#27272a;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;font-weight:700;padding:14px 32px;border:1px solid #dcdbd7;box-sizing:border-box;">Continue to Verification &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px;border-top:1px solid #dcdbd7;background:#f3f2ef;text-align:center;">
            <p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.5;color:#71717a;">
              If you did not request a password reset, you can safely ignore this email.
            </p>
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;color:#71717a;">
              &copy; ${year} Zenvora &middot; <a href="${appUrl}" style="color:#52525b;text-decoration:underline;">${appUrl}</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildPasswordResetEmailText({ name, otp }) {
  const appUrl = appBaseUrl();
  return [
    'Zenvora — Password Reset',
    '',
    `Hi ${name || 'there'},`,
    '',
    `Your verification code: ${otp}`,
    '',
    'This code expires in 10 minutes.',
    '',
    `Continue at: ${appUrl}/verify-otp`,
    '',
    'If you did not request this, ignore this email.',
  ].join('\n');
}

async function sendPasswordResetOtp({ to, otp, name }) {
  if (!smtpConfigured()) {
    const error = new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.');
    error.status = 500;
    throw error;
  }

  const fromName = envTrim('SMTP_FROM_NAME', 'Zenvora');
  const fromEmail = envTrim('SMTP_FROM', envTrim('SMTP_USER'));
  const payload = { name, otp };

  const transporter = createTransport();
  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: 'Your Zenvora password reset code',
    text: buildPasswordResetEmailText(payload),
    html: buildPasswordResetEmailHtml(payload),
  });
}

module.exports = {
  smtpConfigured,
  sendPasswordResetOtp,
  buildPasswordResetEmailHtml,
};
