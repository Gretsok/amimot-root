// Utilitaires partagés entre les specs E2E, extraits des scripts Playwright
// jetables utilisés pendant les audits UX/UI — mêmes sélecteurs/timing déjà
// éprouvés, centralisés ici pour ne pas les redériver dans chaque fichier.

async function createRoom(page, name) {
  await page.goto('/');
  await page.getByPlaceholder('Ton nom (15 caractères max)').fill(name);
  await page.getByRole('button', { name: 'Créer une partie' }).click();
  await page.getByRole('heading', { name: "Salle d'attente" }).waitFor({ timeout: 8000 });
}

async function joinRoom(page, name, code) {
  await page.goto('/');
  await page.getByPlaceholder('Ton nom (15 caractères max)').fill(name);
  await page.getByPlaceholder('CODE').fill(code);
  await page.getByRole('button', { name: 'Rejoindre' }).click();
  await page.getByRole('heading', { name: "Salle d'attente" }).waitFor({ timeout: 8000 });
}

// Révèle le code d'invitation (masqué par défaut, cf. RoomCodeBadge.jsx) et
// le retourne — nécessaire pour qu'un deuxième joueur puisse rejoindre.
async function revealRoomCode(page) {
  await page.getByRole('button', { name: 'Afficher' }).click();
  const codeLocator = page
    .locator('div')
    .filter({ hasText: /^[A-Z0-9]{4,8}$/ })
    .last();
  const code = (await codeLocator.textContent()) || '';
  return code.trim();
}

// Inscrit un compte avec un email/pseudo uniques par appel (évite les 409
// "pseudo déjà pris" entre exécutions/tests parallèles).
async function registerAccount(page, { password = 'TestPassw0rd!' } = {}) {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e-${unique}@example.com`;
  const pseudo = `E2E${unique}`.slice(0, 15);

  await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
  await page.getByText('Pas encore de compte ? Inscris-toi').click();
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Pseudo (15 caractères max)').fill(pseudo);
  await page.getByPlaceholder('Mot de passe').fill(password);
  await page.getByRole('button', { name: "S'inscrire" }).click();
  await page.getByText(`Mon profil (${pseudo})`).waitFor({ timeout: 8000 });

  return { email, pseudo, password };
}

// AuthOverlay conserve son mode (connexion/inscription) entre deux ouvertures
// tant que le composant reste monté (HomeScreen ne le démonte jamais) — après
// une première inscription, une réouverture peut donc retomber en mode
// "inscription" plutôt que "connexion". Ces deux helpers forcent le mode
// voulu plutôt que de supposer lequel est actif.
async function ensureLoginMode(page) {
  const switchToLogin = page.getByText('Déjà un compte ? Connecte-toi');
  if (await switchToLogin.count()) {
    await switchToLogin.click();
  }
}

async function ensureRegisterMode(page) {
  const switchToRegister = page.getByText('Pas encore de compte ? Inscris-toi');
  if (await switchToRegister.count()) {
    await switchToRegister.click();
  }
}

module.exports = {
  createRoom,
  joinRoom,
  revealRoomCode,
  registerAccount,
  ensureLoginMode,
  ensureRegisterMode,
};
