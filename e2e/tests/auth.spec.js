const { test, expect } = require('@playwright/test');
const { registerAccount, ensureLoginMode, ensureRegisterMode } = require('../helpers');

test.describe('Account (auth/profile)', () => {
  test('registers, sees the profile link, and can log out', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);

    await expect(page.getByText(`Mon profil (${pseudo})`)).toBeVisible();

    await page.getByText(`Mon profil (${pseudo})`).click();
    await expect(page.getByRole('heading', { name: 'Mon profil' })).toBeVisible();

    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page.getByRole('button', { name: 'Se connecter / créer un compte' })).toBeVisible();
  });

  test('registering with an already-taken pseudo shows an inline error, not the global popup', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await page.getByText(`Mon profil (${pseudo})`).click();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();

    // Deuxième inscription avec le MÊME pseudo (email différent).
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await ensureRegisterMode(page);
    await page.getByPlaceholder('Email').fill(`e2e-dup-${Date.now()}@example.com`);
    await page.getByPlaceholder('Pseudo (15 caractères max)').fill(pseudo);
    await page.getByPlaceholder('Mot de passe').fill('AutrePassw0rd!');
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
    await page.getByText(`Mon profil (${pseudo})`).click();
    await page.getByRole('button', { name: 'Se déconnecter' }).click();

    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await ensureLoginMode(page);
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Mot de passe').fill('WrongPassword!');
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();

    await expect(page.getByText('Email ou mot de passe invalide.')).toBeVisible();
  });

  test('updates the pseudo from the profile overlay', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await page.getByText(`Mon profil (${pseudo})`).click();

    const newPseudo = `${pseudo}X`.slice(0, 15);
    const pseudoInput = page.locator('[role="dialog"] input[maxlength="15"]');
    await pseudoInput.fill(newPseudo);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    // Ferme et rouvre pour confirmer que le nouveau pseudo a bien été
    // persisté côté serveur (pas juste l'état local du champ).
    await page.mouse.click(10, 10);
    await expect(page.getByText(`Mon profil (${newPseudo})`)).toBeVisible();
  });

  test('deletes the account via the shared Modal confirm step (not window.confirm)', async ({ page }) => {
    await page.goto('/');
    const { pseudo } = await registerAccount(page);
    await page.getByText(`Mon profil (${pseudo})`).click();

    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    await expect(page.getByRole('heading', { name: 'Supprimer ton compte ?' })).toBeVisible();

    // "Annuler" revient au profil sans supprimer.
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('heading', { name: 'Mon profil' })).toBeVisible();

    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    await page.getByRole('button', { name: 'Supprimer définitivement' }).click();

    await expect(page.getByRole('button', { name: 'Se connecter / créer un compte' })).toBeVisible();
  });
});
