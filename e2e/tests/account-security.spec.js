const { test, expect } = require('@playwright/test');
const { registerAccount, goToAccount, ensureLoginMode, E2E_PASSWORD } = require('../helpers');

const NEW_PASSWORD = 'staple gorille lune 42';

// On y arrive par l'URL et non par le lien d'en-tête : ces tests se déconnectent
// depuis /compte, où ce lien n'existe pas (seul "← Retour au jeu" y figure).
async function logOut(page) {
  await page.goto('/compte');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter / créer un compte' })).toBeVisible();
}

async function logIn(page, email, password) {
  await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
  await ensureLoginMode(page);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
}

test.describe('Mot de passe depuis l’espace compte', () => {
  test('changes the password, so only the new one works afterwards', async ({ page }) => {
    await page.goto('/');
    const { email, pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    await page.getByLabel('Mot de passe actuel').fill(E2E_PASSWORD);
    await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Changer mon mot de passe' }).click();
    await expect(page.getByText(/Mot de passe modifié/)).toBeVisible();

    // La session appelante survit au changement : elle vient de prouver
    // qu'elle connaissait le mot de passe actuel.
    await expect(page.getByRole('heading', { name: 'Mon compte' })).toBeVisible();

    await logOut(page);
    await logIn(page, email, E2E_PASSWORD);
    await expect(page.getByText('Email ou mot de passe invalide.')).toBeVisible();

    await page.getByPlaceholder('Mot de passe').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(page.getByRole('link', { name: `Mon compte (${pseudo})` })).toBeVisible();
  });

  // Sans le mot de passe actuel, un poste laissé ouvert suffirait à verrouiller
  // le compte de son propriétaire.
  test('refuses to change without the current password', async ({ page }) => {
    await page.goto('/');
    const { email, pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    // Le bouton reste hors d'atteinte tant que le champ est vide.
    await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
    await expect(page.getByRole('button', { name: 'Changer mon mot de passe' })).toBeDisabled();

    await page.getByLabel('Mot de passe actuel').fill('ce nest pas le bon');
    await page.getByRole('button', { name: 'Changer mon mot de passe' }).click();
    await expect(page.getByText('Mot de passe actuel incorrect.')).toBeVisible();

    // L'ancien mot de passe fonctionne toujours.
    await logOut(page);
    await logIn(page, email, E2E_PASSWORD);
    await expect(page.getByRole('link', { name: `Mon compte (${pseudo})` })).toBeVisible();
  });

  test('enforces the minimum length on the new password', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    await page.getByLabel('Mot de passe actuel').fill(E2E_PASSWORD);
    await page.getByLabel('Nouveau mot de passe').fill('court');
    await expect(page.getByRole('button', { name: 'Changer mon mot de passe' })).toBeDisabled();
  });

  // Le changement suppose de connaître l'actuel : qui l'a oublié doit trouver
  // la sortie ici même.
  test('points a forgetful user to the reset flow', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    await page.getByRole('link', { name: 'Reçois un lien par email' }).click();
    await expect(page).toHaveURL(/\/mot-de-passe-oublie$/);
  });
});

// Le backend E2E tourne sans SMTP : impossible de récupérer le lien reçu. Le
// flux complet (jeton, usage unique, expiration) est couvert côté backend par
// tests/integration/rest/email-verification.routes.test.js.
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
