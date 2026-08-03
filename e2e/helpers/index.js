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
// Le serveur exige au moins 12 caractères ET l'acceptation explicite de la
// politique de confidentialité : un mot de passe court ferait échouer tous les
// tests d'authentification avec une erreur sans rapport avec leur objet.
const E2E_PASSWORD = 'correct horse battery';

async function registerAccount(page, { password = E2E_PASSWORD } = {}) {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e-${unique}@example.com`;
  // Les 12 DERNIERS caractères (pas les premiers) : le pseudo est plafonné à
  // 15 caractères, et tronquer par la gauche coupait justement le suffixe
  // aléatoire — deux tests parallèles inscrits dans la même dizaine de ms
  // repartaient alors avec le même pseudo et un 409 "déjà pris".
  const pseudo = `E2E${unique.slice(-12)}`;

  await page.getByRole('button', { name: 'Se connecter / créer un compte' }).click();
  await page.getByText('Pas encore de compte ? Inscris-toi').click();
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Pseudo (15 caractères max)').fill(pseudo);
  await page.getByPlaceholder('Mot de passe').fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: "S'inscrire" }).click();
  // L'inscription annonce l'email de confirmation avant de rendre la main :
  // la modale ne se ferme plus toute seule. `exact` est indispensable — sans
  // lui le nom est cherché en sous-chaîne et "Continuer" désigne aussi le
  // "Continuer avec Google" du formulaire encore affiché une fraction de
  // seconde, ce qui envoie le navigateur chez Google.
  await page.getByRole('button', { name: 'Continuer', exact: true }).click();
  await page.getByText(`Mon compte (${pseudo})`).waitFor({ timeout: 8000 });

  return { email, pseudo, password };
}

// Le profil est devenu une vraie page (/compte) : plus une modale à ouvrir.
async function goToAccount(page, pseudo) {
  await page.getByRole('link', { name: `Mon compte (${pseudo})` }).click();
  await page.getByRole('heading', { name: 'Mon compte' }).waitFor({ timeout: 8000 });
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
  goToAccount,
  ensureLoginMode,
  ensureRegisterMode,
  E2E_PASSWORD,
};
