export type TransactionalEmailPurpose =
  'RESET_PASSWORD' | 'TEST_NOTIFICATION' | 'VERIFY_ACCOUNT_EMAIL' | 'VERIFY_NOTIFICATION_RECIPIENT';

export interface SecretEmailPayload {
  token?: string;
}

export interface TransactionalEmailContent {
  subject: string;
  text: string;
}

export function transactionalEmailContent(
  purpose: TransactionalEmailPurpose,
  payload: SecretEmailPayload,
  publicWebUrl: string,
): TransactionalEmailContent {
  if (purpose === 'TEST_NOTIFICATION') {
    return {
      subject: 'Site Monitor test notification',
      text: 'This is a test notification. This recipient is ready to receive monitor alerts.',
    };
  }
  if (!payload.token) throw new Error('Secret email token is missing.');
  const accountVerification = purpose === 'VERIFY_ACCOUNT_EMAIL';
  const recipientVerification = purpose === 'VERIFY_NOTIFICATION_RECIPIENT';
  const path = accountVerification
    ? 'verify-email'
    : recipientVerification
      ? 'verify-notification-recipient'
      : 'reset-password';
  const action =
    accountVerification || recipientVerification ? 'Verify your email' : 'Reset your password';
  const link = `${publicWebUrl}/${path}#token=${encodeURIComponent(payload.token)}`;
  return {
    subject: accountVerification
      ? 'Verify your Site Monitor account'
      : recipientVerification
        ? 'Verify your Site Monitor notification address'
        : 'Reset your Site Monitor password',
    text: `${action}: ${link}\n\nThis link expires in one hour.`,
  };
}
