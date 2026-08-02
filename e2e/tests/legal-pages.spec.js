const { test, expect } = require('@playwright/test');

// Art. 12 RGPD : l'information doit être « aisément accessible ». En pratique,
// cela veut dire : joignable depuis l'accueil, sans compte, et citable par
// URL — c'est précisément ce que ces tests vérifient.
test.describe('Pages légales', () => {
  test('are reachable from the home page without an account', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Confidentialité' }).click();
    await expect(page).toHaveURL(/\/confidentialite$/);
    await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible();

    await page.getByRole('link', { name: '← Retour au jeu' }).click();
    await expect(page.getByRole('heading', { name: 'AMIMOT' })).toBeVisible();

    await page.getByRole('link', { name: 'Mentions légales' }).click();
    await expect(page).toHaveURL(/\/mentions-legales$/);
    await expect(page.getByRole('heading', { name: 'Mentions légales' })).toBeVisible();
  });

  // Un lien direct doit fonctionner (favori, lien partagé, robot) : c'est ce
  // que garantit le repli try_files vers index.html côté Caddy.
  test('load directly by URL, not only through client-side navigation', async ({ page }) => {
    await page.goto('/confidentialite');
    await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible();

    await page.goto('/mentions-legales');
    await expect(page.getByRole('heading', { name: 'Mentions légales' })).toBeVisible();
  });

  test('state the controller, the recipients and the retention period', async ({ page }) => {
    await page.goto('/confidentialite');

    await expect(page.getByText(/Fergal Mechin/).first()).toBeVisible();
    await expect(page.getByText(/amimot-assistance@fergalmechin\.fr/).first()).toBeVisible();
    await expect(page.getByText(/OVH SAS/)).toBeVisible();
    await expect(page.getByText(/760 jours/)).toBeVisible();
  });

  test('identify the publisher and the host in the legal notice', async ({ page }) => {
    await page.goto('/mentions-legales');

    await expect(page.getByText(/990501405/)).toBeVisible();
    await expect(page.getByText(/Registre National des Entreprises/)).toBeVisible();
    await expect(page.getByText(/59100 Roubaix/)).toBeVisible();
  });

  test('cross-link to each other', async ({ page }) => {
    await page.goto('/mentions-legales');
    await page.getByRole('link', { name: 'politique de confidentialité' }).click();
    await expect(page).toHaveURL(/\/confidentialite$/);

    await page.getByRole('link', { name: 'Mentions légales' }).click();
    await expect(page).toHaveURL(/\/mentions-legales$/);
  });
});
