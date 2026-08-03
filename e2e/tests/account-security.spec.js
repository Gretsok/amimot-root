const { test, expect } = require('@playwright/test');
const { registerAccount, goToAccount, E2E_PASSWORD } = require('../helpers');

// Le backend E2E tourne sans SMTP : le mailer est inerte et journalise au lieu
// d'envoyer, donc impossible de récupérer le lien. Ces tests couvrent ce qui se
// voit — le parcours et les garde-fous. Le flux complet (jeton, usage unique,
// expiration, révocation des sessions) est couvert côté backend par
// tests/integration/rest/password-change.routes.test.js.
test.describe('Mot de passe depuis l’espace compte', () => {
  test('sends a link to the account address rather than changing it in place', async ({ page }) => {
    await page.goto('/');
    const { email, pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    // L'adresse est affichée : la personne sait où le lien part, et n'a pas à
    // la retaper comme le faisait l'ancien renvoi vers "mot de passe oublié".
    const section = page.locator('section').filter({ hasText: 'Pour changer ton mot de passe' });
    await expect(section).toContainText(email);

    await page.getByRole('button', { name: "M'envoyer le lien" }).click();
    await expect(page.getByText(/Lien envoyé à/)).toContainText(email);
  });

  // Un formulaire "mot de passe actuel + nouveau" tenait cette place : il
  // prouvait une connaissance, pas un accès à la boîte.
  test('offers no in-place password form', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    await expect(page.getByLabel('Mot de passe actuel')).toHaveCount(0);
    await expect(page.getByLabel('Nouveau mot de passe')).toHaveCount(0);
    // Et plus de renvoi vers le parcours anonyme, qui redemandait l'adresse
    // affichée juste au-dessus.
    await expect(page.getByRole('link', { name: /Mot de passe oublié|Reçois un lien/ })).toHaveCount(0);
  });

  test('still reaches the reset screen from the emailed link', async ({ page }) => {
    await page.goto('/reinitialiser?token=jeton-de-test');

    await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible();
    await page.getByPlaceholder('Nouveau mot de passe').fill('court');
    await expect(page.getByRole('button', { name: 'Changer mon mot de passe' })).toBeDisabled();

    await page.getByPlaceholder('Nouveau mot de passe').fill(E2E_PASSWORD);
    await expect(page.getByRole('button', { name: 'Changer mon mot de passe' })).toBeEnabled();
  });
});

test.describe("Confirmation d'adresse", () => {
  test('announces the confirmation email at signup', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await page.getByText('Pas encore de compte ? Inscris-toi').click();

    const email = `e2e-confirm-${Date.now()}@example.com`;
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Pseudo (15 caractères max)').fill(`V${Date.now()}`.slice(0, 15));
    await page.getByPlaceholder('Mot de passe').fill(E2E_PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: "S'inscrire" }).click();

    await expect(page.getByRole('heading', { name: 'Compte créé' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    // Rien dans le jeu n'attend la confirmation : le dire évite de laisser
    // croire qu'il faut relever ses messages pour commencer.
    await expect(page.getByText(/Tu peux jouer sans attendre/)).toBeVisible();
  });

  test('flags the unconfirmed address and can send the link again', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    await expect(page.getByText('Adresse non confirmée')).toBeVisible();
    await expect(page.getByText(/pas encore confirmée/)).toBeVisible();

    await page.getByRole('button', { name: "Renvoyer l'email de confirmation" }).click();
    await expect(page.getByText(/Email de confirmation renvoyé/)).toBeVisible();
  });

  test('explains an expired or invalid confirmation link', async ({ page }) => {
    await page.goto('/confirmer-email?token=jeton-invente');

    await expect(page.getByRole('heading', { name: 'Confirmation de ton adresse' })).toBeVisible();
    await expect(page.getByText(/invalide ou a expiré/)).toBeVisible();
  });

  // Certains clients mail tronquent les liens longs.
  test('offers a way out when the link carries no token', async ({ page }) => {
    await page.goto('/confirmer-email');

    await expect(page.getByText(/lien est incomplet/)).toBeVisible();
  });
});

test.describe('Suppression de compte', () => {
  // Le mail de confirmation part côté serveur (couvert par les tests
  // d'intégration) ; ici on vérifie que la suppression reste franche et que
  // rien ne la retarde ni ne la bloque en attendant un envoi.
  test('deletes without waiting on the confirmation email', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    await page.getByRole('button', { name: 'Supprimer définitivement' }).click();

    await expect(page.getByRole('button', { name: 'Se connecter / créer un compte' })).toBeVisible();
  });
});
