import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../observability/logger';

/**
 * Gmail SMTP sender for AI-generated email reports.
 * Credentials come from env (GMAIL_SMTP_*). Falls back to a no-op logger
 * when not configured so the app still boots without email set up.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const user = process.env.GMAIL_SMTP_USER;
  const pass = process.env.GMAIL_SMTP_PASS;
  if (!user || !pass) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.GMAIL_SMTP_PORT || 465),
      secure: true,
      auth: { user, pass },
    });
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
    const msg = 'Email not configured: GMAIL_SMTP_USER / GMAIL_SMTP_PASS missing. Add them to .env';
    logger.warn(msg);
    return { ok: false, error: msg };
  }
  try {
    const info = await tr.sendMail({
      from: `"Earth Intelligence AI" <${process.env.GMAIL_SMTP_USER}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text || payload.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    logger.info({ to: payload.to, messageId: info.messageId }, 'Email sent via Gmail SMTP');
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error({ err: errMsg, to: payload.to }, 'Email send failed');
    return { ok: false, error: errMsg };
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_SMTP_USER && process.env.GMAIL_SMTP_PASS);
}
