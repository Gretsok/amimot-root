const { test, expect } = require('@playwright/test');
const { createRoom, joinRoom, revealRoomCode } = require('../helpers');

// Le backend E2E tourne avec e2e/fixtures/game-defaults.e2e.json (phases
// courtes, 1 seule manche) — cf. playwright.config.js — donc ce test complet
// d'une manche reste rapide sans dépendre de délais/`waitForTimeout` fragiles.
test('plays a full round: Preparation -> Proposition -> Resolution -> Recap -> Shop', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await createRoom(host, 'Alice');
  const code = await revealRoomCode(host);
  await joinRoom(guest, 'Bob', code);

  await host.getByRole('button', { name: "C'est parti !" }).click();

  // --- Préparation ---
  await expect(host.getByText(/^Lettre : /)).toBeVisible({ timeout: 8000 });
  await expect(guest.getByText(/^Lettre : /)).toBeVisible({ timeout: 8000 });
  await expect(host.getByText('0 / 2 validé·e·s')).toBeVisible();

  const letterText = await host.getByText(/^Lettre : /).textContent();
  const letter = letterText.replace('Lettre : ', '').trim();
  // Mots-pièges distincts du mot proposé plus bas, pour un GROUP_MATCH propre
  // en résolution plutôt qu'un joueur tombant dans son propre piège.
  const trapWord = `${letter}at`;
  const proposalWord = `${letter}mot`;

  await host.getByPlaceholder('Ton mot-piège').fill(trapWord);
  await host.getByRole('button', { name: 'Valider' }).click();
  await expect(host.getByText('1 / 2 validé·e·s')).toBeVisible();

  await guest.getByPlaceholder('Ton mot-piège').fill(`${letter}ib`);
  await guest.getByRole('button', { name: 'Valider' }).click();
  await expect(host.getByText('2 / 2 validé·e·s')).toBeVisible();

  // --- Proposition ---
  await expect(host.getByPlaceholder('Ta proposition')).toBeVisible({ timeout: 8000 });
  await host.getByPlaceholder('Ta proposition').fill(proposalWord);
  await host.getByRole('button', { name: 'Valider' }).click();
  await guest.getByPlaceholder('Ta proposition').fill(proposalWord);
  await guest.getByRole('button', { name: 'Valider' }).click();

  // --- Résolution --- (fin anticipée dès que tout le monde a validé)
  await expect(host.getByRole('heading', { name: 'Récap des contraintes' })).toBeVisible({ timeout: 10000 });
  const nextBtn = host.getByRole('button', { name: 'Mot suivant' });
  if (await nextBtn.count()) {
    await nextBtn.click();
  }

  // --- Récap ---
  await expect(host.getByRole('heading', { name: 'Récap des points' })).toBeVisible({ timeout: 10000 });

  // --- Boutique ---
  await expect(host.getByRole('heading', { name: 'Boutique' })).toBeVisible({ timeout: 8000 });
  await expect(host.getByText(/pièces$/).first()).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});

test('playing a constraint card mid-Preparation adds it to the active constraints list', async ({ browser }) => {
  // La carte de départ est tirée au hasard dans le catalogue (letter-picker) ;
  // 4 des 5 types (tout sauf DESTROY_CONSTRAINT, injouable tant qu'aucune
  // contrainte n'est active) fonctionnent pour ce test. On retente avec une
  // nouvelle room plutôt que de dépendre d'un type précis.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    await createRoom(host, 'Alice');
    const code = await revealRoomCode(host);
    await joinRoom(guest, 'Bob', code);
    await host.getByRole('button', { name: "C'est parti !" }).click();
    await expect(host.getByText(/^Lettre : /)).toBeVisible({ timeout: 8000 });

    // Avant la pose : un seul item dans la liste de contraintes (la lettre de
    // la manche). Sert de référence pour confirmer l'ajout ensuite.
    const constraintsBefore = await guest.getByRole('listitem').count();

    await host.getByRole('button', { name: 'Jouer' }).click();
    const letterInput = host.getByPlaceholder('Lettre', { exact: true });
    const numberInput = host.getByPlaceholder('Nombre de lettres');
    if (await letterInput.count()) {
      await letterInput.fill('a');
    } else if (await numberInput.count()) {
      await numberInput.fill('5');
    }

    const confirmBtn = host.getByRole('button', { name: 'Confirmer' });
    const playable = await confirmBtn.isEnabled();
    if (playable) {
      await confirmBtn.click();
      // La contrainte posée apparaît dans la liste de contraintes actives,
      // visible des deux joueurs (état public), pas seulement chez l'hôte.
      await expect(guest.getByRole('listitem')).toHaveCount(constraintsBefore + 1);
      await hostCtx.close();
      await guestCtx.close();
      return;
    }

    await hostCtx.close();
    await guestCtx.close();
  }

  throw new Error('Could not draw a playable (non-DESTROY_CONSTRAINT) starting card after 5 attempts');
});
