const { test, expect } = require('@playwright/test');
const { registerAccount } = require('../helpers');

// Le backend E2E tourne sans SMTP : le mailer est inerte et journalise au lieu
// d'envoyer. On ne peut donc pas récupérer le lien, et ces tests couvrent ce
// qui se voit — le parcours, les garde-fous et l'absence de fuite d'information.
// Le flux complet (jeton, usage unique, expiration, révocation des sessions)
// est couvert côté backend par tests/integration/rest/password-reset.routes.test.js.
test.describe('Mot de passe oublié', () => {
  test('is reachable from the login form and confirms without revealing anything', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();

    await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
    await expect(page).toHaveURL(/\/mot-de-passe-oublie$/);

    await page.getByPlaceholder('Email').fill('personne-inconnue@example.com');
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();

    // Adresse inconnue : le message doit être exactement celui d'un compte
    // existant, sans quoi l'écran devient un moyen de sonder les adresses.
    await expect(page.getByText(/Si un compte existe/)).toBeVisible();
    await expect(page.getByText(/Google/)).toBeVisible();
  });

  test('shows the same confirmation for an address that does exist', async ({ page }) => {
    await page.goto('/');
    const { email } = await registerAccount(page);

    // Pas besoin de se déconnecter : l'écran est accessible en toute session,
    // et c'est justement l'identité du message qui est vérifiée ici.
    await page.goto('/mot-de-passe-oublie');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();

    await expect(page.getByText(/Si un compte existe/)).toBeVisible();
  });

  test('loads the reset screen directly by URL and enforces the password rule', async ({ page }) => {
    await page.goto('/reinitialiser?token=jeton-de-test');

    await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible();
    await expect(page.getByText(/12 caractères minimum/)).toBeVisible();

    await page.getByPlaceholder('Nouveau mot de passe').fill('court');
    await expect(page.getByRole('button', { name: 'Changer mon mot de passe' })).toBeDisabled();
  });

  test('rejects an invalid token with an explanation rather than a silent failure', async ({ page }) => {
    await page.goto('/reinitialiser?token=jeton-invente');

    await page.getByPlaceholder('Nouveau mot de passe').fill('staple gorille lune 42');
    await page.getByRole('button', { name: 'Changer mon mot de passe' }).click();

    await expect(page.getByText(/invalide ou a expiré/)).toBeVisible();
  });

  // Certains clients mail tronquent les liens longs.
  test('offers a way out when the link carries no token', async ({ page }) => {
    await page.goto('/reinitialiser');

    await expect(page.getByText(/lien est incomplet/)).toBeVisible();
    await page.getByRole('link', { name: 'demande un nouveau lien' }).click();
    await expect(page).toHaveURL(/\/mot-de-passe-oublie$/);
  });
});
