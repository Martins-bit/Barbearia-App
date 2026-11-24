import {
  assertBarberProvisioningAuthorization,
  assertSafeLocalBarberExecution,
  BarberProvisioningSafetyError,
  getSafeBarberProvisioningErrorCode,
  inspectSafeBarberDatabaseDestination,
  isExplicitBarberProvisioningConfirmation,
} from './barber-provisioning-safety';

const authorizedEnvironment = {
  BARBER_PROVISIONING: 'yes',
  BARBER_PROVISIONING_OPERATOR: 'approved-operator',
  BARBER_DATABASE_NAME: 'barbearia',
  DATABASE_URL: 'postgresql://local:secret@127.0.0.1:5432/barbearia',
  NODE_ENV: 'development',
};

describe('barber provisioning safety', () => {
  it('allows only an explicitly configured development environment', () => {
    expect(() =>
      assertBarberProvisioningAuthorization(
        authorizedEnvironment,
        'approved-operator',
      ),
    ).not.toThrow();

    for (const nodeEnv of ['production', 'test', '', undefined] as const) {
      const environment: {
        BARBER_PROVISIONING: string;
        BARBER_PROVISIONING_OPERATOR: string;
        BARBER_DATABASE_NAME: string;
        DATABASE_URL: string;
        NODE_ENV?: string;
      } = { ...authorizedEnvironment };
      if (nodeEnv === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = nodeEnv;

      expect(() =>
        assertBarberProvisioningAuthorization(environment, 'approved-operator'),
      ).toThrow(BarberProvisioningSafetyError);
    }
  });

  it('requires both the enable flag and the approved OS operator', () => {
    expect(() =>
      assertBarberProvisioningAuthorization(
        { ...authorizedEnvironment, BARBER_PROVISIONING_OPERATOR: '' },
        'approved-operator',
      ),
    ).toThrow(BarberProvisioningSafetyError);

    expect(() =>
      assertBarberProvisioningAuthorization(
        authorizedEnvironment,
        'different-operator',
      ),
    ).toThrow(BarberProvisioningSafetyError);

    expect(() =>
      assertBarberProvisioningAuthorization(
        { ...authorizedEnvironment, BARBER_PROVISIONING: '' },
        'approved-operator',
      ),
    ).toThrow(BarberProvisioningSafetyError);
  });

  it.each(['127.0.0.1', '::1'])(
    'accepts only an approved loopback database at %s',
    (host) => {
      const urlHost = host === '::1' ? '[::1]' : host;
      const destination = inspectSafeBarberDatabaseDestination(
        {
          ...authorizedEnvironment,
          DATABASE_URL: `postgresql://local:secret@${urlHost}:5432/barbearia`,
        },
        'approved-operator',
      );

      expect(destination.summary).toBe(
        `host=${host} porta=5432 banco=barbearia`,
      );
      expect(destination.summary).not.toContain('secret');
    },
  );

  it('rejects remote hosts, altered database names and URL routing options', () => {
    const unsafeUrls = [
      'postgresql://local:secret@db.example.com:5432/barbearia',
      'postgresql://local:secret@127.0.0.1:5432/other',
      'postgresql://local:secret@127.0.0.1:5432/barbearia?host=db.example.com',
    ];

    for (const DATABASE_URL of unsafeUrls) {
      expect(() =>
        inspectSafeBarberDatabaseDestination(
          { ...authorizedEnvironment, DATABASE_URL },
          'approved-operator',
        ),
      ).toThrow(BarberProvisioningSafetyError);
    }
  });

  it('requires the confirmation phrase to name the validated database', () => {
    expect(
      isExplicitBarberProvisioningConfirmation(
        'PROVISIONAR BARBEIRO barbearia',
        'barbearia',
      ),
    ).toBe(true);
    expect(
      isExplicitBarberProvisioningConfirmation(
        'PROVISIONAR BARBEIRO outro-banco',
        'barbearia',
      ),
    ).toBe(false);
  });

  it('rejects arguments, non-interactive sessions, CI and remote shells', () => {
    const localInput = {
      argv: ['node', 'create-barber.ts'],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      environment: {},
    };

    expect(() => assertSafeLocalBarberExecution(localInput)).not.toThrow();
    expect(() =>
      assertSafeLocalBarberExecution({
        ...localInput,
        argv: [...localInput.argv, 'barbeiro'],
      }),
    ).toThrow(BarberProvisioningSafetyError);
    expect(() =>
      assertSafeLocalBarberExecution({
        ...localInput,
        stdinIsTTY: false,
      }),
    ).toThrow(BarberProvisioningSafetyError);
    expect(() =>
      assertSafeLocalBarberExecution({
        ...localInput,
        environment: { SSH_CONNECTION: 'present' },
      }),
    ).toThrow(BarberProvisioningSafetyError);
  });

  it('maps internal failures to a safe error code', () => {
    expect(
      getSafeBarberProvisioningErrorCode(
        new Error('sensitive database details'),
      ),
    ).toBe('BARBER_PROVISIONING_INTERNAL');
  });
});
