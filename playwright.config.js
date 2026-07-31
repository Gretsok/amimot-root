const path = require('path');
const { defineConfig } = require('@playwright/test');

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:3000';
const E2E_CONFIG_PATH = path.resolve(__dirname, 'e2e/fixtures/game-defaults.e2e.json');

// Suite E2E couvrant l'application entière (frontend + backend + temps réel)
// tournant ensemble — volontairement en dehors des deux sous-modules
// (backend/, frontend/) puisque c'est justement le "câblage" des deux qui est
// testé ici, pas l'un ou l'autre isolément (cf. AGENTS.md).
module.exports = defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],
  // Un seul projet par défaut (mobile-first, comme l'app elle-même) plutôt
  // que dupliquer chaque spec fonctionnelle sur plusieurs viewports : les
  // vérifications multi-largeurs elles-mêmes vivent dans responsive.spec.js,
  // qui crée ses propres contexts avec des viewports explicites.
  use: {
    baseURL: FRONTEND_URL,
    viewport: { width: 375, height: 812 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node src/server.js',
      cwd: path.resolve(__dirname, 'backend'),
      url: `${BACKEND_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        PORT: '3000',
        JWT_SECRET: 'e2e-test-secret-not-for-production',
        DATABASE_URL: 'postgresql://amimot:amimot@localhost:5433/amimot_test',
        CONFIG_PATH: E2E_CONFIG_PATH,
        // Le process backend tourne en continu sur toute l'exécution de la
        // suite (contrairement aux tests Jest, qui repartent d'un serveur
        // frais par fichier) : sans ça, le rate limit anti-abus sur
        // room:create (20/60s, keyé par IP — toutes les connexions locales
        // en partagent une) serait atteint en cours de suite.
        ROOM_CREATE_RATE_LIMIT_MAX: '500',
        ROOM_JOIN_RATE_LIMIT_MAX: '500',
        GAME_ACTION_RATE_LIMIT_MAX: '500',
      },
    },
    {
      command: 'npm run dev',
      cwd: path.resolve(__dirname, 'frontend'),
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        BACKEND_URL,
      },
    },
  ],
});
