import {
  BREVO_EMAIL_ENDPOINT,
  createEmailVerificationMailer,
} from './brevo-email-verification-mailer';
import { UnconfiguredEmailVerificationMailer } from './email-verification-mailer';

const API_KEY = 'test-api-key';
const SENDER_EMAIL = 'nao-responda@example.com';
const RECIPIENT_EMAIL = 'cliente@example.com';
const TOKEN = 'A_very-specific-code-123';
const DELIVERY_ERROR = 'Não foi possível enviar o e-mail.';

function makeMailer(
  fetcher: jest.MockedFunction<typeof fetch> = jest.fn(),
  overrides: NodeJS.ProcessEnv = {},
) {
  const environment: NodeJS.ProcessEnv = {
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: API_KEY,
    BREVO_SENDER_EMAIL: SENDER_EMAIL,
    BREVO_SENDER_NAME: 'Barbearia do Bruno',
    EMAIL_TIMEOUT_MS: '1000',
    ...overrides,
  };

  return {
    fetcher,
    mailer: createEmailVerificationMailer(environment, fetcher),
  };
}

function requestBody(fetcher: jest.MockedFunction<typeof fetch>) {
  return JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as {
    sender: { email: string; name: string };
    to: { email: string }[];
    subject: string;
    htmlContent: string;
    textContent: string;
  };
}

describe('BrevoEmailVerificationMailer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends an HTML and text confirmation message using the official endpoint', async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'message-id' }), {
        status: 201,
      }),
    );
    const { mailer } = makeMailer(fetcher);

    await mailer.sendVerificationEmail(RECIPIENT_EMAIL, TOKEN);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      BREVO_EMAIL_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetcher.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'api-key': API_KEY }),
        signal: expect.any(AbortSignal),
      }),
    );
    const body = requestBody(fetcher);
    expect(body.sender).toEqual({ email: SENDER_EMAIL, name: 'Barbearia do Bruno' });
    expect(body.to).toEqual([{ email: RECIPIENT_EMAIL }]);
    expect(body.subject).toContain('Confirme seu endereço de e-mail');
    expect(body.htmlContent).toContain(TOKEN);
    expect(body.htmlContent).toContain('30 minutos');
    expect(body.textContent).toContain(TOKEN);
    expect(body.textContent).toContain('30 minutos');
  });

  it('sends a password recovery message containing the exact requested code', async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const { mailer } = makeMailer(fetcher);

    await mailer.sendPasswordResetEmail(RECIPIENT_EMAIL, TOKEN);

    const body = requestBody(fetcher);
    expect(body.subject).toContain('redefinir sua senha');
    expect(body.htmlContent).toContain(TOKEN);
    expect(body.textContent).toContain(TOKEN);
    expect(body.textContent).toContain('15 minutos');
  });

  it('uses the configured timeout and translates aborts to a sanitized error', async () => {
    const fetcher = jest.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const { mailer } = makeMailer(fetcher, { EMAIL_TIMEOUT_MS: '1' });

    await expect(
      mailer.sendPasswordResetEmail(RECIPIENT_EMAIL, TOKEN),
    ).rejects.toThrow(DELIVERY_ERROR);
  });

  it('sanitizes non-success HTTP responses without reading provider details', async () => {
    const sensitiveProviderBody = `${API_KEY} ${TOKEN} ${RECIPIENT_EMAIL}`;
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(sensitiveProviderBody, { status: 401 }),
    );
    const { mailer } = makeMailer(fetcher);

    await expect(
      mailer.sendVerificationEmail(RECIPIENT_EMAIL, TOKEN),
    ).rejects.toThrow(DELIVERY_ERROR);
    await expect(
      mailer.sendVerificationEmail(RECIPIENT_EMAIL, TOKEN),
    ).rejects.not.toThrow(sensitiveProviderBody);
  });

  it('sanitizes network failures and does not log sensitive information', async () => {
    const sensitiveNetworkError = new Error(
      `${API_KEY} ${TOKEN} ${RECIPIENT_EMAIL}`,
    );
    const fetcher = jest
      .fn<typeof fetch>()
      .mockRejectedValue(sensitiveNetworkError);
    const errorLog = jest.spyOn(console, 'error');
    const warningLog = jest.spyOn(console, 'warn');
    const { mailer } = makeMailer(fetcher);

    let thrownError: unknown;
    try {
      await mailer.sendPasswordResetEmail(RECIPIENT_EMAIL, TOKEN);
    } catch (error) {
      thrownError = error;
    }

    expect(String(thrownError)).toBe(`Error: ${DELIVERY_ERROR}`);
    expect(String(thrownError)).not.toContain(API_KEY);
    expect(String(thrownError)).not.toContain(TOKEN);
    expect(String(thrownError)).not.toContain(RECIPIENT_EMAIL);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
  });

  it('keeps sending disabled unless Brevo is explicitly selected', () => {
    const mailer = createEmailVerificationMailer({});

    expect(mailer).toBeInstanceOf(UnconfiguredEmailVerificationMailer);
    expect(mailer.isAvailable()).toBe(false);
  });

  it.each([
    [{ BREVO_API_KEY: '' }],
    [{ BREVO_SENDER_EMAIL: '' }],
  ])('rejects missing required credentials without revealing values', (missing) => {
    const privateValue = 'must-not-appear-in-errors';
    const environment: NodeJS.ProcessEnv = {
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: API_KEY,
      BREVO_SENDER_EMAIL: SENDER_EMAIL,
      ...missing,
      BREVO_SENDER_NAME: privateValue,
    };

    expect(() => createEmailVerificationMailer(environment)).toThrow(
      'BREVO_API_KEY e BREVO_SENDER_EMAIL são obrigatórios',
    );
    expect(() => createEmailVerificationMailer(environment)).toThrow(
      expect.not.stringContaining(privateValue),
    );
  });
});