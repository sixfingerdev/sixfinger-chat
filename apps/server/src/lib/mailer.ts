import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.ts';
import type { Locale } from '@sixfinger/shared';

export interface Mailer {
  sendCode(opts: { to: string; code: string; purpose: 'verify' | 'reset'; locale: Locale }): Promise<void>;
}

const COPY = {
  tr: {
    verify: {
      subject: (c: string) => `SixFinger doğrulama kodun: ${c}`,
      title: 'E-postanı doğrula',
      body: 'Hesabını doğrulamak için bu kodu kullan. Kod 15 dakika geçerli.',
    },
    reset: {
      subject: (c: string) => `SixFinger şifre sıfırlama kodun: ${c}`,
      title: 'Şifreni sıfırla',
      body: 'Şifreni sıfırlamak için bu kodu kullan. Kod 15 dakika geçerli.',
    },
    footer: 'Bu işlemi sen başlatmadıysan bu e-postayı yok sayabilirsin.',
  },
  en: {
    verify: {
      subject: (c: string) => `Your SixFinger verification code: ${c}`,
      title: 'Verify your email',
      body: 'Use this code to verify your account. It is valid for 15 minutes.',
    },
    reset: {
      subject: (c: string) => `Your SixFinger password reset code: ${c}`,
      title: 'Reset your password',
      body: 'Use this code to reset your password. It is valid for 15 minutes.',
    },
    footer: "If you didn't request this, you can ignore this email.",
  },
} as const;

function render(code: string, purpose: 'verify' | 'reset', locale: Locale) {
  const t = COPY[locale][purpose];
  const footer = COPY[locale].footer;
  const spaced = code.split('').join(' ');
  const html = `<!doctype html><html><body style="margin:0;background:#0b0b0c;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="420" style="max-width:420px;background:#141416;border:1px solid #26262a;border-radius:16px;">
<tr><td style="padding:32px 32px 8px;color:#f4f4f5;font-size:13px;letter-spacing:.18em;font-weight:600;">SIXFINGER</td></tr>
<tr><td style="padding:8px 32px 0;color:#f4f4f5;font-size:22px;font-weight:600;">${t.title}</td></tr>
<tr><td style="padding:12px 32px 0;color:#a1a1aa;font-size:15px;line-height:1.5;">${t.body}</td></tr>
<tr><td style="padding:24px 32px;"><div style="background:#0b0b0c;border:1px solid #26262a;border-radius:12px;padding:18px;text-align:center;color:#ffffff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:30px;letter-spacing:.2em;">${spaced}</div></td></tr>
<tr><td style="padding:0 32px 32px;color:#71717a;font-size:12px;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${t.title}\n\n${t.body}\n\n${code}\n\n${footer}`;
  return { subject: t.subject(code), html, text };
}

export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  let transport: Transporter | undefined;
  if (config.smtpEnabled) {
    transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
  }
  return {
    async sendCode({ to, code, purpose, locale }) {
      const mail = render(code, purpose, locale);
      if (!transport) {
        // SMTP yapılandırılmamış: geliştirme kolaylığı için kodu logla.
        log.warn({ to, purpose, code }, 'SMTP kapalı — e-posta gönderilmedi, kod loglandı');
        return;
      }
      await transport.sendMail({ from: config.SMTP_FROM, to, ...mail });
    },
  };
}
