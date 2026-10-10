import { describe, expect, it } from 'vitest';

import { transactionalEmailContent } from './email-content.js';

describe('transactional email content', () => {
  it('keeps notification-recipient verification separate from account verification', () => {
    const recipient = transactionalEmailContent(
      'VERIFY_NOTIFICATION_RECIPIENT',
      { token: 'recipient-secret' },
      'http://localhost:15173',
    );
    const account = transactionalEmailContent(
      'VERIFY_ACCOUNT_EMAIL',
      { token: 'account-secret' },
      'http://localhost:15173',
    );
    expect(recipient.subject).toContain('notification address');
    expect(recipient.text).toContain('/verify-notification-recipient#token=recipient-secret');
    expect(account.subject).toContain('account');
    expect(account.text).toContain('/verify-email#token=account-secret');
  });

  it('renders a test message without requiring or embedding a secret token', () => {
    const content = transactionalEmailContent('TEST_NOTIFICATION', {}, 'http://localhost:15173');
    expect(content.subject).toBe('Site Monitor test notification');
    expect(content.text).not.toContain('token');
    expect(content.text).not.toContain('http://');
  });

  it('rejects a missing token for secret-bearing purposes', () => {
    expect(() => transactionalEmailContent('RESET_PASSWORD', {}, 'http://localhost:15173')).toThrow(
      'Secret email token is missing.',
    );
  });
});
