const { test, expect } = require('@playwright/test');
const { createRoom, joinRoom, revealRoomCode } = require('../helpers');

// La config e2e (e2e/fixtures/game-defaults.e2e.json) n'a qu'une seule manche
// : après Boutique, la partie passe directement à ENDED — inutile de
// déclencher un stop/config spécial pour atteindre EndGameRanking ici.
test('reaches the final ranking after a single round and returns to the Lobby', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await createRoom(host, 'Alice');
  const code = await revealRoomCode(host);
  await joinRoom(guest, 'Bob', code);
  await host.getByRole('button', { name: "C'est parti !" }).click();

  await expect(host.getByText(/^Lettre : /)).toBeVisible({ timeout: 8000 });
  const letterText = await host.getByText(/^Lettre : /).textContent();
  const letter = letterText.replace('Lettre : ', '').trim();
  // Mots-pièges distincts du mot proposé, pour un GROUP_MATCH propre (les
  // deux marquent le même nombre de points) plutôt qu'un piège auto-déclenché.
  const trapWord = `${letter}at`;
  const proposalWord = `${letter}mot`;

  await host.getByPlaceholder('Ton mot-piège').fill(trapWord);
  await host.getByRole('button', { name: 'Valider' }).click();
  await guest.getByPlaceholder('Ton mot-piège').fill(`${letter}ib`);
  await guest.getByRole('button', { name: 'Valider' }).click();

  await expect(host.getByPlaceholder('Ta proposition')).toBeVisible({ timeout: 8000 });
  await host.getByPlaceholder('Ta proposition').fill(proposalWord);
  await host.getByRole('button', { name: 'Valider' }).click();
  await guest.getByPlaceholder('Ta proposition').fill(proposalWord);
  await guest.getByRole('button', { name: 'Valider' }).click();

  await expect(host.getByRole('heading', { name: 'Récap des contraintes' })).toBeVisible({ timeout: 10000 });
  // Les deux joueurs ont dit le même mot : un seul mot à révéler, donc le
  // premier bouton de progression est déjà celui qui clôt la phase.
  await host.getByRole('button', { name: 'Défilement manuel' }).click();
  await host.getByRole('button', { name: 'Voir les points' }).click();

  await expect(host.getByRole('heading', { name: 'Récap des points' })).toBeVisible({ timeout: 10000 });
  await host.getByRole('button', { name: 'Passer à la boutique' }).click();
  await expect(host.getByRole('heading', { name: 'Boutique' })).toBeVisible({ timeout: 8000 });

  // Une seule manche configurée : Boutique expire directement vers ENDED.
  await expect(host.getByRole('heading', { name: 'Classement final' })).toBeVisible({ timeout: 8000 });
  await expect(guest.getByRole('heading', { name: 'Classement final' })).toBeVisible({ timeout: 8000 });

  // Classement "à la sportive" : score identique (mot en commun) -> même rang.
  const ranks = host.getByText('1', { exact: true });
  await expect(ranks).toHaveCount(2);

  await host.getByRole('button', { name: 'Retour au lobby' }).click();
  await expect(host.getByRole('heading', { name: "Salle d'attente" })).toBeVisible({ timeout: 8000 });

  await hostCtx.close();
  await guestCtx.close();
});
