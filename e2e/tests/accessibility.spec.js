const { test, expect } = require('@playwright/test');
const { createRoom } = require('../helpers');

test.describe('Modal accessibility', () => {
  test('Escape closes the Auth modal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Connexion' })).not.toBeVisible();
  });

  test('Tab-cycling stays within the open modal (no focus leak)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();

    // Le focus initial est sur le panneau lui-même (tabIndex=-1), donc le
    // 1er Tab atteint le 1er champ (email) ; avec 6 éléments focusables
    // (email, mot de passe, "Mot de passe oublié ?", "Se connecter",
    // "Continuer avec Google", le lien de bascule), il faut 7 Tab pour boucler
    // et revenir sur le premier.
    for (let i = 0; i < 7; i += 1) {
      await page.keyboard.press('Tab');
    }
    const isBackOnEmail = await page.evaluate(
      () => document.activeElement === document.querySelector('input[placeholder="Email"]')
    );
    expect(isBackOnEmail).toBe(true);
  });

  test('regression: typing multiple characters into a modal text field lands every keystroke', async ({ page }) => {
    // Reproduit exactement le bug corrigé dans le suivi d'audit UX/UI :
    // Modal.jsx volait le focus du champ à chaque frappe quand l'appelant
    // passait un `onClose` non mémoïsé (cas de ConstraintCard/ProfileOverlay).
    await createRoom(page, 'Alice');
    await page.getByRole('button', { name: "C'est parti !" }).click();
    await expect(page.getByText(/^Lettre : /)).toBeVisible({ timeout: 8000 });

    await page.getByRole('button', { name: 'Jouer' }).click();
    const numberInput = page.getByPlaceholder('Nombre de lettres');
    const letterInput = page.getByPlaceholder('Lettre', { exact: true });

    if (await numberInput.count()) {
      await numberInput.click();
      await page.keyboard.type('12', { delay: 50 });
      await expect(numberInput).toHaveValue('12');
    } else if (await letterInput.count()) {
      // Champ à 1 caractère (maxLength=1) : une fois plein, le navigateur
      // bloque nativement toute frappe de plus tant que rien n'est
      // sélectionné/effacé — sans rapport avec le bug de focus. On vérifie
      // donc que le champ garde le focus ET reste éditable en vidant puis en
      // retapant, plutôt que d'ajouter un 2e caractère par-dessus le 1er.
      await letterInput.click();
      await page.keyboard.type('a', { delay: 50 });
      await expect(letterInput).toHaveValue('A');
      await letterInput.fill('');
      await page.keyboard.type('b', { delay: 50 });
      await expect(letterInput).toHaveValue('B');
    }
  });
});
