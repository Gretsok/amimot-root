const { test, expect } = require('@playwright/test');
const { createRoom, joinRoom, revealRoomCode } = require('../helpers');

test.describe('Home & Lobby', () => {
  test('creates a room and shows the host in the player list', async ({ page }) => {
    await createRoom(page, 'Alice');
    await expect(page.getByText('Alice').first()).toBeVisible();
    await expect(page.getByText('HÔTE')).toBeVisible();
    await expect(page.getByText('1 / 10')).toBeVisible();
  });

  test('a second player joins by invite code and both see 2 players', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    await createRoom(host, 'Alice');
    const code = await revealRoomCode(host);
    expect(code).toMatch(/^[A-Z0-9]{4,8}$/);

    await joinRoom(guest, 'Bob', code);

    await expect(host.getByText('2 / 10')).toBeVisible();
    await expect(guest.getByText('2 / 10')).toBeVisible();
    await expect(guest.getByText('Alice')).toBeVisible();
    await expect(host.getByText('Bob')).toBeVisible();

    await hostCtx.close();
    await guestCtx.close();
  });

  test('joining with an invalid room code shows the error popup', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Ton nom (15 caractères max)').fill('Alice');
    await page.getByPlaceholder('CODE').fill('ZZZZZZ');
    await page.getByRole('button', { name: 'Rejoindre' }).click();

    await expect(page.getByText('Oups !')).toBeVisible();
    await expect(page.getByText("Cette room n'existe pas (ou plus).")).toBeVisible();

    await page.getByRole('button', { name: 'Retour au menu' }).click();
    await expect(page.getByText('Oups !')).not.toBeVisible();
  });

  test('the host can reveal/hide and copy the room code', async ({ page }) => {
    await createRoom(page, 'Alice');
    await expect(page.getByText('••••••')).toBeVisible();

    const code = await revealRoomCode(page);
    await expect(page.getByText(code)).toBeVisible();

    await page.getByRole('button', { name: 'Masquer' }).click();
    await expect(page.getByText('••••••')).toBeVisible();
  });

  test('the host can kick a player', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    await createRoom(host, 'Alice');
    const code = await revealRoomCode(host);
    await joinRoom(guest, 'Bob', code);
    await expect(host.getByText('2 / 10')).toBeVisible();

    await host.getByRole('button', { name: 'Exclure Bob' }).click();
    await expect(host.getByText('1 / 10')).toBeVisible();

    await hostCtx.close();
    await guestCtx.close();
  });

  test('the host can update the max-players setting', async ({ page }) => {
    await createRoom(page, 'Alice');
    const input = page.getByLabel('Joueurs max');
    await input.fill('4');
    await page.getByRole('button', { name: 'OK' }).click();
    // Le compteur du haut affiche joueurs-actuels / max — un seul joueur
    // (l'hôte) reste présent, seul le plafond change.
    await expect(page.getByText('1 / 4')).toBeVisible();
  });

  test('leaving the room returns to Home', async ({ page }) => {
    await createRoom(page, 'Alice');
    await page.getByRole('button', { name: 'Quitter' }).click();
    await expect(page.getByRole('heading', { name: 'AMIMOT' })).toBeVisible();
  });
});
