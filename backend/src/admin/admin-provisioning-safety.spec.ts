import {
  assertOperationalAuthorization,
  getSafeProvisioningErrorCode,
  inspectSafeDatabaseDestination,
  isExplicitDestinationConfirmation,
  FirstAdminSafetyError,
} from './admin-provisioning-safety';

describe('admin provisioning safety', () => {
  it('rejects execution when operational authorization is absent', () => {
    expect(() =>
      assertOperationalAuthorization({
        DATABASE_URL: 'postgresql://local@127.0.0.1:5432/barbearia',
      }),
    ).toThrow(FirstAdminSafetyError);
  });

  it('rejects remote and public destinations', () => {
    const hosts = [
      'db.exemplo.com',
      'postgres.internal',
      '203.0.113.10',
      '10.0.0.10',
    ];

    for (const host of hosts) {
      expect(() =>
        inspectSafeDatabaseDestination({
          FIRST_ADMIN_PROVISIONING: 'yes',
          FIRST_ADMIN_DATABASE_NAME: 'barbearia',
          DATABASE_URL: `postgresql://usuario:secret@${host}:5432/barbearia?schema=public`,
        }),
      ).toThrow(FirstAdminSafetyError);
    }
  });

  it.each(['127.0.0.1', '::1'])(
    'accepts approved loopback destination %s',
    (host) => {
      const urlHost = host === '::1' ? '[::1]' : host;
      const destination = inspectSafeDatabaseDestination({
        FIRST_ADMIN_PROVISIONING: 'yes',
        FIRST_ADMIN_DATABASE_NAME: 'barbearia',
        DATABASE_URL: `postgresql://usuario:secret@${urlHost}:5432/barbearia`,
      });

      expect(destination.database).toBe('barbearia');
      expect(destination.summary).not.toContain('usuario');
      expect(destination.summary).not.toContain('secret');
      expect(destination.summary).not.toContain('DATABASE_URL');
    },
  );

  it('rejects malformed, unknown and mismatched database destinations', () => {
    expect(() =>
      inspectSafeDatabaseDestination({
        FIRST_ADMIN_PROVISIONING: 'yes',
        DATABASE_URL: 'not-a-url',
      }),
    ).toThrow(FirstAdminSafetyError);

    expect(() =>
      inspectSafeDatabaseDestination({
        FIRST_ADMIN_PROVISIONING: 'yes',
        DATABASE_URL: 'postgresql://usuario:secret@127.0.0.1:5432/',
      }),
    ).toThrow(FirstAdminSafetyError);

    expect(() =>
      inspectSafeDatabaseDestination({
        FIRST_ADMIN_PROVISIONING: 'yes',
        FIRST_ADMIN_DATABASE_NAME: 'barbearia',
        DATABASE_URL:
          'postgresql://usuario:secret@127.0.0.1:5432/production_database',
      }),
    ).toThrow(FirstAdminSafetyError);
  });

  it('rejects query parameters and redirecting connection options', () => {
    const unsafeUrls = [
      'postgresql://usuario:secret@127.0.0.1:5432/barbearia?host=db.exemplo.com',
      'postgresql://usuario:secret@127.0.0.1:5432/barbearia?hostaddr=10.0.0.10',
      'postgresql://usuario:secret@127.0.0.1:5432/barbearia?service=production',
      'postgresql://usuario:secret@127.0.0.1:5432/barbearia?options=-csearch_path%3Dpublic',
      'postgresql://usuario:secret@127.0.0.1:5432/barbearia#fragment',
      'postgresql://usuario:secret@localhost1,db.exemplo.com:5432/barbearia',
    ];

    for (const databaseUrl of unsafeUrls) {
      expect(() =>
        inspectSafeDatabaseDestination({
          FIRST_ADMIN_PROVISIONING: 'yes',
          FIRST_ADMIN_DATABASE_NAME: 'barbearia',
          DATABASE_URL: databaseUrl,
        }),
      ).toThrow(FirstAdminSafetyError);
    }
  });

  it('requires an explicit database name and exact URL name match', () => {
    expect(() =>
      inspectSafeDatabaseDestination({
        FIRST_ADMIN_PROVISIONING: 'yes',
        DATABASE_URL:
          'postgresql://usuario:secret@127.0.0.1:5432/barbearia',
      }),
    ).toThrow(FirstAdminSafetyError);

    expect(() =>
      inspectSafeDatabaseDestination({
        FIRST_ADMIN_PROVISIONING: 'yes',
        FIRST_ADMIN_DATABASE_NAME: 'Barbearia',
        DATABASE_URL:
          'postgresql://usuario:secret@127.0.0.1:5432/barbearia',
      }),
    ).toThrow(FirstAdminSafetyError);
  });

  it('requires exact explicit destination confirmation', () => {
    expect(isExplicitDestinationConfirmation('PROVISIONAR')).toBe(true);
    expect(isExplicitDestinationConfirmation('provisionar')).toBe(false);
    expect(isExplicitDestinationConfirmation('yes')).toBe(false);
  });

  it('maps unexpected errors to a generic internal code', () => {
    expect(
      getSafeProvisioningErrorCode(
        new Error('sensitive postgres credentials and query'),
      ),
    ).toBe('ADMIN_PROVISIONING_INTERNAL');

    expect(
      getSafeProvisioningErrorCode(
        new FirstAdminSafetyError(
          'DATABASE_DESTINATION_NOT_LOCAL',
          'safe generic message',
        ),
      ),
    ).toBe('DATABASE_DESTINATION_NOT_LOCAL');
  });
});
