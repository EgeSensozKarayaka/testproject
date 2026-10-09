import { expect, test, type APIRequestContext } from '@playwright/test';

interface MailpitMessage {
  Snippet: string;
  To: { Address: string }[];
}

async function verificationToken(request: APIRequestContext, email: string): Promise<string> {
  await expect
    .poll(
      async () => {
        const response = await request.get('http://127.0.0.1:8025/api/v1/messages');
        const body = (await response.json()) as { messages: MailpitMessage[] };
        const message = body.messages.find((item) =>
          item.To.some((recipient) => recipient.Address === email),
        );
        return message?.Snippet.match(/#token=([A-Za-z0-9_-]+)/)?.[1] ?? null;
      },
      { timeout: 10_000 },
    )
    .not.toBeNull();

  const response = await request.get('http://127.0.0.1:8025/api/v1/messages');
  const body = (await response.json()) as { messages: MailpitMessage[] };
  const message = body.messages.find((item) =>
    item.To.some((recipient) => recipient.Address === email),
  );
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

  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible();
});
