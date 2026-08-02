const { test, expect } = require('@playwright/test');
const {
  registerAccount,
  goToAccount,
  ensureLoginMode,
  ensureRegisterMode,
  E2E_PASSWORD,
} = require('../helpers');

test.describe('Account (auth/espace compte)', () => {
  test('registers, reaches the account space at its own URL, and can log out', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);

    await expect(page.getByRole('link', { name: `Mon compte (${pseudo})` })).toBeVisible();

    await goToAccount(page, pseudo);
    // Une vraie route, pas une modale : l'URL doit refléter où l'on est.
    await expect(page).toHaveURL(/\/compte$/);

    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page.getByRole('button', { name: 'Se connecter / créer un compte' })).toBeVisible();
  });

  test('registering with an already-taken pseudo shows an inline error, not the global popup', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);
    await page.getByRole('button', { name: 'Se déconnecter' }).click();

    // Deuxième inscription avec le MÊME pseudo (email différent).
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await ensureRegisterMode(page);
    await page.getByPlaceholder('Email').fill(`e2e-dup-${Date.now()}@example.com`);
    await page.getByPlaceholder('Pseudo (15 caractères max)').fill(pseudo);
    await page.getByPlaceholder('Mot de passe').fill(E2E_PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: "S'inscrire" }).click();

    await expect(page.getByText('Ce pseudo est déjà pris.')).toBeVisible();
    // Toujours sur le formulaire (pas le popup global "Oups !"), le champ
    // saisi n'a pas été perdu.
    await expect(page.getByText('Oups !')).not.toBeVisible();
    await expect(page.getByPlaceholder('Pseudo (15 caractères max)')).toHaveValue(pseudo);
  });

  test('logging in with the wrong password shows an inline error', async ({ page }) => {
    await page.goto('/');
    const { email, pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);
    await page.getByRole('button', { name: 'Se déconnecter' }).click();

    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await ensureLoginMode(page);
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Mot de passe').fill('WrongPasswordEntirely');
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

    await expect(page.getByText('Email ou mot de passe invalide.')).toBeVisible();
  });

  // Art. 12-13 : l'information doit être délivrée à la collecte. Le bouton ne
  // doit donc pas être actionnable sans la déclaration d'âge / la politique.
  test('cannot sign up without acknowledging the policy and the age minimum', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await ensureRegisterMode(page);

    await page.getByPlaceholder('Email').fill(`e2e-consent-${Date.now()}@example.com`);
    await page.getByPlaceholder('Pseudo (15 caractères max)').fill(`C${Date.now()}`.slice(0, 15));
    await page.getByPlaceholder('Mot de passe').fill(E2E_PASSWORD);

    await expect(page.getByRole('button', { name: "S'inscrire" })).toBeDisabled();
    await expect(page.getByText(/760 jours/)).toBeVisible();

    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: "S'inscrire" })).toBeEnabled();
  });

  test('refuses a password below the minimum length', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await ensureRegisterMode(page);

    await expect(page.getByText(/12 caractères minimum/)).toBeVisible();
    await page.getByPlaceholder('Mot de passe').fill('court');
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: "S'inscrire" })).toBeDisabled();
  });

  test('updates the pseudo from the account space', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    // Le pseudo généré fait déjà 15 caractères (le maximum) : ajouter un
    // suffixe puis tronquer le laisserait identique, et "Enregistrer" reste
    // alors désactivé — à raison. On remplace donc le dernier caractère.
    const newPseudo = `${pseudo.slice(0, -1)}X`;
    await page.locator('#pseudo').fill(newPseudo);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    // Retour à l'accueil : le nouveau pseudo doit venir du serveur, pas de
    // l'état local du champ.
    await page.getByRole('link', { name: '← Retour au jeu' }).click();
    await expect(page.getByRole('link', { name: `Mon compte (${newPseudo})` })).toBeVisible();
  });

  test('deletes the account via the shared Modal confirm step (not window.confirm)', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    await expect(page.getByRole('heading', { name: 'Supprimer ton compte ?' })).toBeVisible();

    // "Annuler" revient à l'espace compte sans supprimer.
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('heading', { name: 'Mon compte' })).toBeVisible();

    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    await page.getByRole('button', { name: 'Supprimer définitivement' }).click();

    // Compte supprimé -> renvoyé à l'accueil, déconnecté.
    await expect(page.getByRole('button', { name: 'Se connecter / créer un compte' })).toBeVisible();
  });

  // Droit d'accès et portabilité (art. 15 et 20) : le fichier doit vraiment
  // être produit, pas seulement le bouton exister.
  test('downloads the personal data export', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await goToAccount(page, pseudo);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Télécharger mes données' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('amimot-donnees.json');
  });

  // /compte est réservé aux personnes connectées : y arriver sans session doit
  // renvoyer à l'accueil, pas afficher un écran vide.
  test('redirects to home when reaching /compte without a session', async ({ page }) => {
    await page.goto('/compte');
    await expect(page.getByRole('heading', { name: 'AMIMOT' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
