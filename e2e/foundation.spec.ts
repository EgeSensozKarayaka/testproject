import { expect, test, type APIRequestContext } from '@playwright/test';
import nodemailer from 'nodemailer';

import { renderIncidentEmail } from '../packages/notifications/src/index.js';

interface MailpitMessage {
  ID: string;
  Snippet: string;
  Subject: string;
  To: { Address: string }[];
}

async function deliveredMessage(
  request: APIRequestContext,
  email: string,
  subject: string,
): Promise<MailpitMessage> {
  await expect
    .poll(
      async () => {
        const response = await request.get('http://127.0.0.1:8025/api/v1/messages');
        const body = (await response.json()) as { messages: MailpitMessage[] };
        return (
          body.messages.find(
            (item) =>
              item.Subject === subject && item.To.some((recipient) => recipient.Address === email),
          ) ?? null
        );
      },
      { timeout: 10_000 },
    )
    .not.toBeNull();

  const response = await request.get('http://127.0.0.1:8025/api/v1/messages');
  const body = (await response.json()) as { messages: MailpitMessage[] };
  const message = body.messages.find(
    (item) => item.Subject === subject && item.To.some((recipient) => recipient.Address === email),
  );
  if (!message) throw new Error(`Message "${subject}" was not delivered to Mailpit.`);
  return message;
}

async function verificationToken(
  request: APIRequestContext,
  email: string,
  subject = 'Verify your Site Monitor account',
): Promise<string> {
  const message = await deliveredMessage(request, email, subject);
  const token = message?.Snippet.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('Verification token was not delivered to Mailpit.');
  return token;
}

test('serves the authentication frontend', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Giriş yap' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yeni hesap' })).toBeVisible();
});

test('supports two independent browser clients', async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  await Promise.all([firstPage.goto('/'), secondPage.goto('/')]);
  await Promise.all([
    expect(firstPage.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible(),
    expect(secondPage.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible(),
  ]);

  await Promise.all([firstContext.close(), secondContext.close()]);
});

test('delivers every operational template to Mailpit with text and HTML', async ({ request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `incident-templates-${suffix}@example.test`;
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port: 1025,
    secure: false,
  });
  const templates = [
    {
      payload: {
        check_name: 'E2E Primary API',
        confirmed_at: '2026-10-10T10:00:30.000Z',
        failure_category: 'TIMEOUT',
        started_at: '2026-10-10T10:00:00.000Z',
      },
      template: 'INCIDENT_DOWN' as const,
    },
    {
      payload: {
        check_name: 'E2E Primary API',
        ended_at: '2026-10-10T10:02:00.000Z',
        observed_duration_ms: '90000',
        started_at: '2026-10-10T10:00:00.000Z',
      },
      template: 'INCIDENT_RECOVERED' as const,
    },
    {
      payload: {
        check_name: 'E2E Primary API',
        closure_reason: 'CONFIG_CHANGED',
        ended_at: '2026-10-10T10:02:00.000Z',
      },
      template: 'MONITORING_ENDED' as const,
    },
  ];

  try {
    for (const { payload, template } of templates) {
      const content = renderIncidentEmail(template, 1, payload);
      await transport.sendMail({
        from: 'Site Monitor <no-reply@site-monitor.local>',
        html: content.html,
        messageId: `<e2e.${template.toLowerCase()}.${suffix}@site-monitor.local>`,
        subject: content.subject,
        text: content.text,
        to: email,
      });
      const delivered = await deliveredMessage(request, email, content.subject);
      const response = await request.get(`http://127.0.0.1:8025/api/v1/message/${delivered.ID}`);
      const message = (await response.json()) as { HTML: string; Text: string };
      expect(message.Text.replaceAll('\r\n', '\n').trim()).toBe(content.text);
      expect(message.HTML.trim()).toBe(content.html);
    }
  } finally {
    transport.close();
  }
});

test('registers, verifies through Mailpit, logs in, and logs out', async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${suffix}@example.test`;
  const password = `Fjord!Mosaic-${suffix}-Reliable`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Yeni hesap' }).click();
  await page.getByLabel('Görünen ad').fill('E2E User');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Parola').fill(password);
  await page.getByRole('button', { name: 'Hesap oluştur' }).click();
  await expect(page.getByRole('status')).toContainText('doğrulama bağlantısı');

  const token = await verificationToken(request, email);
  await page.goto(`/verify-email#token=${token}`);
  await expect(page.getByRole('status')).toContainText('E-posta adresiniz doğrulandı');

  await page.goto('/');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Parola').fill(password);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page.getByRole('heading', { name: 'Hoş geldiniz, E2E User' })).toBeVisible();

  const api = page.context().request;
  const sessionResponse = await api.get('http://localhost:13000/api/v1/auth/session');
  expect(sessionResponse.ok()).toBe(true);
  const session = (await sessionResponse.json()) as { csrf_token: string };
  const browserCommandHeaders = {
    Origin: 'http://localhost:15173',
    'Sec-Fetch-Site': 'same-site',
    'X-CSRF-Token': session.csrf_token,
  };
  const notificationEmail = `alerts-${suffix}@example.test`;
  const recipientResponse = await api.post(
    'http://localhost:13000/api/v1/notification-recipients',
    {
      data: { email: notificationEmail },
      headers: {
        ...browserCommandHeaders,
        'Idempotency-Key': `e2e-recipient-${suffix}`,
      },
    },
  );
  expect(recipientResponse.status()).toBe(201);
  const recipient = (await recipientResponse.json()) as { id: string };
  const recipientToken = await verificationToken(
    request,
    notificationEmail,
    'Verify your Site Monitor notification address',
  );
  const confirmRecipientResponse = await api.post(
    'http://localhost:13000/api/v1/notification-recipient-verifications/confirm',
    {
      data: { token: recipientToken },
      headers: {
        Origin: browserCommandHeaders.Origin,
        'Sec-Fetch-Site': browserCommandHeaders['Sec-Fetch-Site'],
      },
    },
  );
  expect(confirmRecipientResponse.status()).toBe(204);
  const testEmailResponse = await api.post(
    `http://localhost:13000/api/v1/notification-recipients/${recipient.id}/test-email`,
    {
      headers: {
        ...browserCommandHeaders,
        'Idempotency-Key': `e2e-test-email-${suffix}`,
      },
    },
  );
  expect(testEmailResponse.status()).toBe(202);
  const testMessage = await deliveredMessage(
    request,
    notificationEmail,
    'Site Monitor test notification',
  );
  const messageResponse = await request.get(
    `http://127.0.0.1:8025/api/v1/message/${testMessage.ID}`,
  );
  const message = (await messageResponse.json()) as { HTML: string; Text: string };
  expect(message.Text).toContain('This is a test notification.');
  expect(message.HTML).toContain('<p>This is a test notification.');

  await page.getByText('Yeni grup oluştur').click();
  await page.getByLabel('Grup adı').fill('E2E Services');
  await page.getByLabel(/Açıklama/).fill('Browser acceptance resources');
  await page.getByRole('button', { name: 'Grup oluştur' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Services' })).toBeVisible();

  await page.getByRole('button', { name: 'Kontrol ekle' }).click();
  await page.getByLabel('Kontrol adı').fill('E2E Homepage');
  await page.getByLabel('URL').fill('https://example.com/health');
  await page.locator('select[name="group_id"]').selectOption({ label: 'E2E Services' });
  await page.getByRole('button', { name: 'Kontrol ekle', exact: true }).last().click();
  let checkCard = page.locator('.check-card').filter({ hasText: 'E2E Homepage' });
  await expect(checkCard.getByRole('heading', { name: 'E2E Homepage' })).toBeVisible();

  await checkCard.getByRole('button', { name: 'Şimdi çalıştır' }).click();
  await expect(page.getByRole('status')).toContainText('Manuel kontrol kuyruğa alındı');
  await checkCard.getByRole('button', { name: 'Duraklat' }).click();
  checkCard = page.locator('.check-card').filter({ hasText: 'E2E Homepage' });
  await expect(checkCard.getByRole('button', { name: 'Devam ettir' })).toBeVisible();
  await checkCard.getByRole('button', { name: 'Devam ettir' }).click();
  await expect(checkCard.getByRole('button', { name: 'Duraklat' })).toBeVisible();

  const secondContext = await page.context().browser()!.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto('/');
  await secondPage.getByLabel('E-posta').fill(email);
  await secondPage.getByLabel('Parola').fill(password);
  await secondPage.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(secondPage.getByRole('heading', { name: 'Hoş geldiniz, E2E User' })).toBeVisible();

  await checkCard.getByRole('button', { name: 'Düzenle' }).click();
  await page.getByLabel('Kontrol adı').fill('Stale first-tab edit');

  const secondCheckCard = secondPage.locator('.check-card').filter({ hasText: 'E2E Homepage' });
  await secondCheckCard.getByRole('button', { name: 'Düzenle' }).click();
  await secondPage.getByLabel('Kontrol adı').fill('Updated in second tab');
  await secondPage.getByRole('button', { name: 'Kontrolü güncelle' }).click();
  await expect(secondPage.getByRole('heading', { name: 'Updated in second tab' })).toBeVisible();

  await page.getByRole('button', { name: 'Kontrolü güncelle' }).click();
  await expect(page.getByRole('alert')).toContainText('başka bir oturumda değiştirildi');
  checkCard = page.locator('.check-card').filter({ hasText: 'Updated in second tab' });
  await expect(checkCard.getByRole('heading', { name: 'Updated in second tab' })).toBeVisible();
  await secondContext.close();

  await checkCard.getByRole('button', { name: 'Sil' }).click();
  await checkCard.getByRole('button', { name: 'Silmeyi onayla' }).click();
  await expect(page.getByRole('heading', { name: 'Updated in second tab' })).toHaveCount(0);

  const groupCard = page.locator('.group-grid .resource-card').filter({ hasText: 'E2E Services' });
  await groupCard.getByRole('button', { name: 'Sil' }).click();
  await groupCard.getByRole('button', { name: 'Silmeyi onayla' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Services' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible();
});
