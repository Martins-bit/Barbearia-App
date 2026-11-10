import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export const EMAIL_VERIFICATION_MAILER = Symbol('EMAIL_VERIFICATION_MAILER');

export interface EmailVerificationMailer {
  isAvailable(): boolean;
  sendVerificationEmail(email: string, token: string): Promise<void>;
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
}

@Injectable()
export class UnconfiguredEmailVerificationMailer
  implements EmailVerificationMailer
{
  isAvailable(): boolean {
    return false;
  }

  async sendVerificationEmail(): Promise<void> {
    throw new ServiceUnavailableException(
      'O envio de e-mail ainda não está configurado.',
    );
  }

  async sendPasswordResetEmail(): Promise<void> {
    throw new ServiceUnavailableException(
      'O envio de e-mail ainda não está configurado.',
    );
  }
}