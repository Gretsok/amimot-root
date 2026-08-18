#!/usr/bin/env node
// Vérifie qu'un round complet se joue réellement de bout en bout sur le
// déploiement courant — pas seulement que les endpoints HTTP répondent.
// Conçu pour tourner DANS le conteneur backend (mêmes dépendances, même
// réseau) via smoke-test.sh :
//   docker compose exec -T backend node - < deploy/smoke-test-gameplay.js
//
// Rejoue le chemin exact qui a cassé le 2026-08-18 : la vérification
// dictionnaire (wordExists()) est absente de l'image construite (Dockerfile
// ne copiait pas data/), donc la transition PROPOSITION -> RESOLUTION
// échouait silencieusement (runGuarded journalise et laisse la partie
// bloquée plutôt que de faire planter le process — cf.
// phase-timer.manager.js). Les suites Jest/Vitest/Playwright tournent
// toutes depuis l'arbre source, jamais depuis l'image construite : ce
// chemin précis n'était couvert que par un contrôle manuel (cf.
// docs/verification-post-deploiement.md, "jouer une partie").

const { io: ioClient } = require('socket.io-client');

const URL = process.env.SMOKE_BACKEND_URL || 'http://localhost:3000';
const TIMEOUT_MS = 40000;

// Un vrai mot français par lettre : le mot-piège et la proposition doivent
// tous deux passer wordExists() (cf. src/domain/game/constraints.js), donc
// plus possible de les construire à la volée depuis la lettre tirée (cf.
// backend/tests/helpers/word-fixtures.js, même principe).
const PROPOSAL_WORD_BY_LETTER = {
  A: 'avion', B: 'bateau', C: 'chat', D: 'dauphin', E: 'ecole', F: 'fromage',
  G: 'gateau', H: 'hibou', I: 'image', J: 'jardin', K: 'kilo', L: 'lion',
  M: 'maison', N: 'nuage', O: 'oiseau', P: 'pomme', Q: 'quatre', R: 'raisin',
  S: 'soleil', T: 'table', U: 'usine', V: 'valise', W: 'wagon', X: 'xenophobie',
  Y: 'yacht', Z: 'zebre',
};
const TRAP_WORD_BY_LETTER = {
  A: 'ananas', B: 'banane', C: 'camion', D: 'danse', E: 'etoile', F: 'fable',
  G: 'gant', H: 'habile', I: 'iceberg', J: 'jacasser', K: 'kanak', L: 'lampe',
  M: 'melon', N: 'nabot', O: 'oasis', P: 'piano', Q: 'quai', R: 'radis',
  S: 'sable', T: 'tigre', U: 'ukase', V: 'village', W: 'wallon', X: 'xavier',
  Y: 'yack', Z: 'zaire',
};

function connect() {
  return new Promise((resolve, reject) => {
    const socket = ioClient(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitAsync(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Interroge en boucle plutôt que d'écouter un seul événement de diffusion :
// deux transitions peuvent partir dans le même tick et la diffusion
// intermédiaire se perdre (même piège que game-lifecycle.test.js).
async function waitForPhase(client, phase, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const { publicState } = await emitAsync(client, 'game:requestState', {});
    if (publicState && publicState.phase === phase) return publicState;
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  // Le mode d'échec réel (dictionnaire absent, etc.) ne remonte PAS comme un
  // ack {ok:false} : la transition de phase plante en interne et
  // `runGuarded` (phase-timer.manager.js) journalise puis laisse la partie
  // bloquée là où elle est, sans jamais répondre à personne. Le seul indice
  // visible depuis l'extérieur est donc ce timeout — on pointe direct vers
  // le journal qui, lui, contient la vraie cause.
  throw new Error(
    `délai dépassé en attendant la phase "${phase}" (>${timeoutMs}ms) — la partie est bloquée dans la phase précédente. ` +
      'Cause probable : voir « docker compose logs backend | grep \'\\[phase-timer\\]\' »'
  );
}

async function main() {
  const host = await connect();
  const guest = await connect();

  const created = await emitAsync(host, 'room:create', { displayName: 'SmokeHost' });
  if (!created || !created.room) throw new Error(`room:create a échoué : ${JSON.stringify(created)}`);

  const joined = await emitAsync(guest, 'room:join', {
    inviteCode: created.room.inviteCode,
    displayName: 'SmokeGuest',
  });
  if (!joined || !joined.player) throw new Error(`room:join a échoué : ${JSON.stringify(joined)}`);

  const startRes = await emitAsync(host, 'room:start', {});
  if (!startRes.ok) throw new Error(`room:start a échoué : ${JSON.stringify(startRes)}`);
  const started = await waitForEvent(guest, 'game:started');
  const letter = String(started.publicState.letter).toUpperCase();
  console.log(`    lettre de manche : ${letter}`);

  const trapWord = TRAP_WORD_BY_LETTER[letter];
  const proposalWord = PROPOSAL_WORD_BY_LETTER[letter];

  const trapSubmit = await emitAsync(host, 'game:submitTrapWord', { text: trapWord });
  if (!trapSubmit.ok) {
    throw new Error(
      `mot-piège "${trapWord}" refusé : ${JSON.stringify(trapSubmit)} — vérifier que ` +
        'data/dictionary/liste_francais.txt est bien présent dans l\'image backend'
    );
  }
  await emitAsync(host, 'game:validateTrapWord', {});

  await waitForPhase(host, 'PROPOSITION', 20000);

  const hostProp = await emitAsync(host, 'game:submitProposition', { text: proposalWord });
  if (!hostProp.ok) {
    throw new Error(
      `proposition "${proposalWord}" refusée : ${JSON.stringify(hostProp)} — vérifier que ` +
        'data/dictionary/liste_francais.txt est bien présent dans l\'image backend'
    );
  }
  await emitAsync(host, 'game:validateProposition', {});
  await emitAsync(guest, 'game:submitProposition', { text: proposalWord });
  await emitAsync(guest, 'game:validateProposition', {});

  // C'est précisément cette transition qui échouait silencieusement le
  // 2026-08-18 quand le dictionnaire manquait dans l'image construite.
  await waitForPhase(host, 'RESOLUTION', 10000);

  await emitAsync(host, 'game:advanceResolution', { action: 'next' });
  await emitAsync(host, 'game:advanceResolution', { action: 'next' });
  const recapState = await waitForPhase(host, 'RECAP', 10000);
  if (!(recapState.scores && Object.values(recapState.scores).some((s) => s > 0))) {
    throw new Error(`aucun score positif en RECAP : ${JSON.stringify(recapState.scores)}`);
  }

  await emitAsync(host, 'game:advanceRecap', {});
  await waitForPhase(host, 'SHOP', 10000);

  host.close();
  guest.close();
}

const globalTimeout = setTimeout(() => {
  console.error(`round de test en échec : dépassement du délai global (${TIMEOUT_MS}ms)`);
  process.exit(1);
}, TIMEOUT_MS);
globalTimeout.unref();

main()
  .then(() => {
    console.log(
      '    un round complet (Préparation → Proposition → Résolution → Récap → Boutique) se joue de bout en bout'
    );
    clearTimeout(globalTimeout);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`round de test en échec : ${err.message}`);
    clearTimeout(globalTimeout);
    process.exit(1);
  });
