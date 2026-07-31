const { test, expect } = require('@playwright/test');
const { createRoom, joinRoom, revealRoomCode } = require('../helpers');

test('shows a player as disconnected shortly after they leave, without removing them', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await createRoom(host, 'Alice');
  const code = await revealRoomCode(host);
  await joinRoom(guest, 'Bob', code);
  await expect(host.getByText('2 / 10')).toBeVisible();
  await expect(host.getByText('Déconnecté')).not.toBeVisible();

  await guestCtx.close();

  await expect(host.getByText('Déconnecté')).toBeVisible({ timeout: 5000 });
  // Toujours listé (juste marqué déconnecté), pas retiré de la room.
  await expect(host.getByText('2 / 10')).toBeVisible();
  await expect(host.getByText('Bob')).toBeVisible();

  await hostCtx.close();
});

test('reloading restores the reconnecting player\'s own room state via sessionToken', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await createRoom(host, 'Alice');
  const code = await revealRoomCode(host);
  await joinRoom(guest, 'Bob', code);

  // sessionStorage (où vit le sessionToken) survit à un reload de page — au
  // contraire de la fermeture d'un contexte — donc c'est le bon moyen de
  // déclencher réellement le flux room:reconnect de GameContext.jsx.
  await guest.reload();

  await expect(guest.getByRole('heading', { name: "Salle d'attente" })).toBeVisible({ timeout: 8000 });
  await expect(guest.getByText('2 / 10')).toBeVisible();
  await expect(guest.getByText('Alice')).toBeVisible();
  await expect(guest.getByText('Bob')).toBeVisible();

  // Et l'hôte revoit Bob comme connecté après sa reconnexion.
  await expect(host.getByText('Déconnecté')).not.toBeVisible({ timeout: 5000 });

  await hostCtx.close();
  await guestCtx.close();
});
