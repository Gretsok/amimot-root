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
  // Deux propositions DIFFÉRENTES : la résolution a donc deux mots à dérouler,
  // ce qui permet de vérifier qu'aucun n'est sauté (régression).
  const hostWord = `${letter}mot`;
  const guestWord = `${letter}oiseau`;

  await host.getByPlaceholder('Ton mot-piège').fill(trapWord);
  await host.getByRole('button', { name: 'Valider' }).click();
  await expect(host.getByText('1 / 2 validé·e·s')).toBeVisible();

  await guest.getByPlaceholder('Ton mot-piège').fill(`${letter}ib`);
  await guest.getByRole('button', { name: 'Valider' }).click();
  await expect(host.getByText('2 / 2 validé·e·s')).toBeVisible();

  // --- Proposition ---
  await expect(host.getByPlaceholder('Ta proposition')).toBeVisible({ timeout: 8000 });
  await host.getByPlaceholder('Ta proposition').fill(hostWord);
  await host.getByRole('button', { name: 'Valider' }).click();
  await guest.getByPlaceholder('Ta proposition').fill(guestWord);
  await guest.getByRole('button', { name: 'Valider' }).click();

  // --- Résolution --- (fin anticipée dès que tout le monde a validé)
  await expect(host.getByRole('heading', { name: 'Récap des contraintes' })).toBeVisible({ timeout: 10000 });
  // Le rythme se choisit une fois, et ce choix EST ce qui lance la révélation.
  await host.getByRole('button', { name: 'Défilement manuel' }).click();

  // Régression : la phase se terminait dès la révélation du dernier mot, donc
  // le second mot n'était jamais affiché.
  await expect(host.getByText('Mot 1 sur 2')).toBeVisible({ timeout: 8000 });
  await host.getByRole('button', { name: 'Mot suivant' }).click();
  await expect(host.getByText('Mot 2 sur 2')).toBeVisible({ timeout: 8000 });
  await expect(guest.getByText('Mot 2 sur 2')).toBeVisible({ timeout: 8000 });
  await host.getByRole('button', { name: 'Voir les points' }).click();

  // --- Récap --- (aucun chrono : il attend l'hôte)
  await expect(host.getByRole('heading', { name: 'Récap des points' })).toBeVisible({ timeout: 10000 });
  await expect(guest.getByText(/En attente de l'hôte/)).toBeVisible();
  await host.getByRole('button', { name: 'Passer à la boutique' }).click();

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

// Régression du bug "une erreur de contrainte de carte renvoie le joueur au
// menu" : refuser une carte ne doit jamais sortir le joueur de sa partie.
test('a card refused because it would invalidate the own trap word keeps the player in the game', async ({ browser }) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
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
    const trapWord = `${letter}at`; // 3 lettres, contient un "a"

    await host.getByPlaceholder('Ton mot-piège').fill(trapWord);
    await expect(host.getByRole('button', { name: 'Valider' })).toBeEnabled();

    await host.getByRole('button', { name: 'Jouer' }).click();
    const letterInput = host.getByPlaceholder('Lettre', { exact: true });
    const numberInput = host.getByPlaceholder('Nombre de lettres');

    // Valeur choisie pour contredire volontairement le mot-piège ci-dessus,
    // quel que soit le type de carte tiré au hasard.
    const title = await host.locator('[role="dialog"] h3').textContent();
    if (await letterInput.count()) {
      await letterInput.fill(title.includes('Interdire') ? 'A' : 'Z');
    } else if (await numberInput.count()) {
      await numberInput.fill(title.includes('maximale') ? '2' : '9');
    } else {
      // DESTROY_CONSTRAINT : ne peut pas invalider un mot-piège, on retente.
      await hostCtx.close();
      await guestCtx.close();
      continue;
    }

    // La pose est refusée AVANT l'envoi, avec une explication.
    await expect(host.getByText('Cette carte invaliderait ton propre mot-piège.')).toBeVisible();
    await expect(host.getByRole('button', { name: 'Confirmer' })).toBeDisabled();

    // Et surtout : le joueur est TOUJOURS dans sa partie — ni popup fatal, ni
    // retour à l'accueil.
    await expect(host.getByText('Oups !')).not.toBeVisible();
    await expect(host.getByRole('button', { name: 'Retour au menu' })).not.toBeVisible();
    await host.keyboard.press('Escape');
    await expect(host.getByText(/^Lettre : /)).toBeVisible();
    await expect(host.getByRole('heading', { name: 'AMIMOT' })).not.toBeVisible();

    await hostCtx.close();
    await guestCtx.close();
    return;
  }

  throw new Error('Could not draw a constraint card able to invalidate a trap word after 6 attempts');
});
