import type { EmailVerificationMailer } from './email-verification-mailer';
import { UnconfiguredEmailVerificationMailer } from './email-verification-mailer';

export const BREVO_EMAIL_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SENDER_NAME = 'Barbearia do Bruno';
const MAX_TIMEOUT_MS = 2_147_483_647;
const DELIVERY_ERROR_MESSAGE = 'Não foi possível enviar o e-mail.';

interface BrevoEmailConfiguration {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  timeoutMs: number;
  publicAppUrl: string;
}

interface BrevoMessage {
  subject: string;
  htmlContent: string;
  textContent: string;
}

export function createEmailVerificationMailer(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = globalThis.fetch,
): EmailVerificationMailer {
  const provider = environment.EMAIL_PROVIDER ?? 'disabled';

  if (provider === 'disabled') {
    return new UnconfiguredEmailVerificationMailer();
  }
  if (provider !== 'brevo') {
    throw new Error('EMAIL_PROVIDER deve ser "disabled" ou "brevo".');
  }

  const apiKey = environment.BREVO_API_KEY?.trim();
  const senderEmail = environment.BREVO_SENDER_EMAIL?.trim();
  if (!apiKey || !senderEmail) {
    throw new Error(
      'BREVO_API_KEY e BREVO_SENDER_EMAIL são obrigatórios quando EMAIL_PROVIDER=brevo.',
    );
  }

  const timeoutMs = parseTimeout(environment.EMAIL_TIMEOUT_MS);
  const senderName = environment.BREVO_SENDER_NAME?.trim();
  const publicAppUrl = parsePublicAppUrl(
    environment.PUBLIC_APP_URL,
    environment.NODE_ENV,
  );

  return new BrevoEmailVerificationMailer(
    {
      apiKey,
      senderEmail,
      senderName: senderName || DEFAULT_SENDER_NAME,
      timeoutMs,
      publicAppUrl,
    },
    fetcher,
  );
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      'EMAIL_TIMEOUT_MS deve ser um inteiro entre 1 e 2147483647.',
    );
  }

  return timeoutMs;
}

export function parsePublicAppUrl(
  value: string | undefined,
  nodeEnv: string | undefined,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    if (nodeEnv === 'production') {
      throw new Error(
        'PUBLIC_APP_URL é obrigatório em produção quando o Brevo estiver ativo.',
      );
    }
    return 'http://localhost:5173';
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('PUBLIC_APP_URL deve ser uma URL pública válida.');
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('PUBLIC_APP_URL deve ser uma URL pública válida.');
  }

  if (nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL deve usar HTTPS em produção.');
  }

  if (
    nodeEnv === 'production' &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1')
  ) {
    throw new Error(
      'PUBLIC_APP_URL não pode usar localhost em produção.',
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.origin + (url.pathname === '/' ? '' : url.pathname);
}

function buildAuthLink(publicAppUrl: string, path: string, token: string): string {
  return `${publicAppUrl}${path}?token=${encodeURIComponent(token)}`;
}

class BrevoEmailVerificationMailer implements EmailVerificationMailer {
  constructor(
    private readonly configuration: BrevoEmailConfiguration,
    private readonly fetcher: typeof fetch,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const confirmationUrl = buildAuthLink(
      this.configuration.publicAppUrl,
      '/confirmar-email',
      token,
    );
    await this.send(email, {
      subject: 'Confirme seu endereço de e-mail | Barbearia do Bruno',
      htmlContent: this.renderHtml(
        'Confirme seu endereço de e-mail',
        'Use o código abaixo para confirmar o endereço de e-mail da sua conta:',
        token,
        'O código expira em 30 minutos. Se você não solicitou esta confirmação, ignore esta mensagem.',
        confirmationUrl,
        'Confirmar endereço',
      ),
      textContent: [
        'Confirme seu endereço de e-mail',
        '',
        'Use o código abaixo para confirmar o endereço de e-mail da sua conta:',
        '',
        token,
        '',
        `Confirme pelo link: ${confirmationUrl}`,
        '',
        'O código expira em 30 minutos. Se você não solicitou esta confirmação, ignore esta mensagem.',
        '',
        'Barbearia do Bruno',
      ].join('\n'),
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = buildAuthLink(
      this.configuration.publicAppUrl,
      '/redefinir-senha',
      token,
    );
    await this.send(email, {
      subject: 'Código para redefinir sua senha | Barbearia do Bruno',
      htmlContent: this.renderHtml(
        'Redefina sua senha',
        'Use o código abaixo na tela de redefinição de senha:',
        token,
        'O código expira em 15 minutos. Se você não solicitou a recuperação, ignore esta mensagem; sua senha não será alterada.',
        resetUrl,
        'Redefinir senha',
      ),
      textContent: [
        'Redefina sua senha',
        '',
        'Use o código abaixo na tela de redefinição de senha:',
        '',
        token,
        '',
        `Redefina sua senha pelo link: ${resetUrl}`,
        '',
        'O código expira em 15 minutos. Se você não solicitou a recuperação, ignore esta mensagem; sua senha não será alterada.',
        '',
        'Barbearia do Bruno',
      ].join('\n'),
    });
  }

  private renderHtml(
    title: string,
    introduction: string,
    token: string,
    notice: string,
    actionUrl: string,
    actionLabel: string,
  ): string {
    const safeActionUrl = escapeHtml(actionUrl);
    const safeToken = escapeHtml(token);
    return [
      '<!doctype html>',
      '<html lang="pt-BR">',
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
      '<body>',
      `<h1>${title}</h1>`,
      `<p>${introduction}</p>`,
      `<p style="font-size: 24px; font-weight: 700; letter-spacing: 2px">${safeToken}</p>`,
      `<p><a href="${safeActionUrl}">${escapeHtml(actionLabel)}</a></p>`,
      `<p>${notice}</p>`,
      '<p>Barbearia do Bruno</p>',
      '</body>',
      '</html>',
    ].join('');
  }

  private async send(email: string, message: BrevoMessage): Promise<void> {
    try {
      const response = await this.fetcher(BREVO_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': this.configuration.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            email: this.configuration.senderEmail,
            name: this.configuration.senderName,
          },
          to: [{ email }],
          subject: message.subject,
          htmlContent: message.htmlContent,
          textContent: message.textContent,
        }),
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(DELIVERY_ERROR_MESSAGE);
      }
    } catch {
      throw new Error(DELIVERY_ERROR_MESSAGE);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}