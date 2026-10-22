import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../observability/logger';
import { keyManager } from '../keyManager';

/**
 * Gmail SMTP sender for AI-generated email reports.
 * Credentials come from env (GMAIL_SMTP_*) or the encrypted keyManager vault.
 * Falls back cleanly with clear diagnostics so users can download HTML reports
 * even if email SMTP is not configured.
 */

let transporter: Transporter | null = null;
let lastUser: string | null = null;
let lastPass: string | null = null;
let lastHost: string | null = null;
let lastPort: number | null = null;

function getTransporter(): Transporter | null {
  const user = (process.env.GMAIL_SMTP_USER || keyManager.get('GMAIL_SMTP_USER') || '').trim();
  const pass = (process.env.GMAIL_SMTP_PASS || keyManager.get('GMAIL_SMTP_PASS') || '').trim();
  if (!user || !pass) {
    return null;
  }

  const host = (process.env.GMAIL_SMTP_HOST || keyManager.get('GMAIL_SMTP_HOST') || 'smtp.gmail.com').trim();
  const port = Number(process.env.GMAIL_SMTP_PORT || keyManager.get('GMAIL_SMTP_PORT') || 465);

  if (!transporter || lastUser !== user || lastPass !== pass || lastHost !== host || lastPort !== port) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    lastUser = user;
    lastPass = pass;
    lastHost = host;
    lastPort = port;
  }
  return transporter;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const tr = getTransporter();
  if (!tr) {
    const msg = 'Email not configured: GMAIL_SMTP_USER / GMAIL_SMTP_PASS missing. Add them to .env or Admin Key Vault';
    logger.warn(msg);
    return { ok: false, error: msg };
  }
  if (!payload.to || !payload.to.trim()) {
    const msg = 'No recipient email configured. Set GMAIL_REPORT_TO in .env or configure in Admin Key Vault';
    logger.warn(msg);
    return { ok: false, error: msg };
  }
  try {
    const fromUser = (process.env.GMAIL_SMTP_USER || keyManager.get('GMAIL_SMTP_USER') || '').trim();
    const info = await tr.sendMail({
      from: `"Earth Intelligence AI" <${fromUser}>`,
      to: payload.to.trim(),
      subject: payload.subject,
      html: payload.html,
      text: payload.text || payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    logger.info({ to: payload.to, messageId: info.messageId }, 'Email sent via Gmail SMTP');
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    let errMsg = e instanceof Error ? e.message : String(e);
    if (errMsg.includes('535') || errMsg.includes('BadCredentials') || errMsg.includes('Username and Password not accepted')) {
      errMsg = 'Gmail authentication failed (BadCredentials). Please generate a fresh Google App Password at myaccount.google.com/apppasswords';
    }
    logger.error({ err: errMsg, to: payload.to }, 'Email send failed');
    return { ok: false, error: errMsg };
  }
}

export function isEmailConfigured(): boolean {
  const user = (process.env.GMAIL_SMTP_USER || keyManager.get('GMAIL_SMTP_USER') || '').trim();
  const pass = (process.env.GMAIL_SMTP_PASS || keyManager.get('GMAIL_SMTP_PASS') || '').trim();
  return Boolean(user && pass);
}
