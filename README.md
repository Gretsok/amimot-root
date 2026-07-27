# Amimot

Squelette technique d'un jeu social en ligne façon Gartic Phone : connexion,
lobby, mini-jeu placeholder (chrono + bouton collectif), retour au lobby,
relance. Voir le cahier des charges et le plan d'architecture pour le détail
des règles métier.

## Structure du dépôt

```
amimot/
├── config/game-defaults.json   # config partagée (délais, tailles de room, RGPD...)
├── docker-compose.yml          # stack de prod (seul le frontend publie un port)
├── docker-compose.override.yml # surcouche dev (hot-reload), fusionnée automatiquement
├── backend/                    # Express + Prisma + Socket.io — sous-module git séparé
└── frontend/                   # React + Vite — sous-module git séparé
```

> `backend/` et `frontend/` sont conçus comme des dépôts Git distincts
> (`amimot-backend`, `amimot-frontend`). Le rattachement en véritables
> sous-modules Git (`git submodule add`) n'a pas encore été fait dans ce
> dépôt — pour l'instant ce sont de simples dossiers avec leur propre `.git`
> local. Demander si vous voulez que ce soit finalisé.

## Prérequis

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (avec Docker Compose v2)
- Node.js 22+ et npm (uniquement si vous voulez lancer le backend ou le frontend hors Docker)

## Premier démarrage

1. Copier le fichier d'environnement racine :
   ```bash
   cp .env.example .env
   ```
   Ajuster au besoin (`FRONTEND_PORT` si le port 5173 est déjà pris sur votre
   machine, secrets Postgres/JWT, identifiants Google OAuth si vous en avez).

2. Lancer toute la stack :
   ```bash
   docker compose up -d --build
   ```
   Cette commande charge automatiquement `docker-compose.yml` **et**
   `docker-compose.override.yml` (comportement par défaut de Compose) : vous
   obtenez donc le mode dev avec hot-reload (nodemon côté backend, serveur
   Vite côté frontend), exposé en clair (HTTP, pas de TLS en dev) sur
   `http://localhost:<FRONTEND_PORT>` — la valeur définie dans votre `.env`
   (5173 par défaut).

3. Vérifier que ça répond :
   ```bash
   curl http://localhost:<FRONTEND_PORT>/api/config/game-defaults
   ```
   Puis ouvrir `http://localhost:<FRONTEND_PORT>/` dans un navigateur.

4. Arrêter :
   ```bash
   docker compose down
   ```

## Lancer la stack en mode "prod" (sans hot-reload, avec HTTPS)

Pour ignorer la surcouche dev et utiliser exactement les images de production
(build React statique servi par [Caddy](https://caddyserver.com/), backend
sans nodemon) :

```bash
docker compose -f docker-compose.yml up -d --build
```

Dans ce mode, seul le conteneur `frontend` publie des ports sur l'hôte
(`HTTP_PORT:80` et `HTTPS_PORT:443`) ; `backend` et `postgres` ne sont
accessibles que via le réseau Docker interne, conformément à la contrainte du
cahier des charges. Caddy gère le HTTPS automatiquement :

- **Local / test sans nom de domaine** (valeurs par défaut de `.env.example`,
  `DOMAIN=localhost` + `TLS_MODE=internal`) : Caddy génère un certificat
  auto-signé tout seul. Le navigateur affichera un avertissement de sécurité
  (certificat non reconnu) — normal, c'est attendu en local.
- **VPS avec un vrai domaine** : voir la section suivante.

## Déployer sur un VPS (ex. OVH) avec un vrai certificat HTTPS

1. **Domaine** : pointe un enregistrement DNS `A` de ton domaine (ou
   sous-domaine, ex. `amimot.tondomaine.fr`) vers l'IP publique du VPS.
2. **Pare-feu** : ouvre les ports **80** et **443** en entrée sur le VPS
   (`ufw allow 80,443/tcp` si tu utilises `ufw`) et dans le firewall réseau
   d'OVH si tu en as configuré un (Manager OVH → réseau → firewall).
   Le port 80 doit rester ouvert même si tu ne veux servir qu'en HTTPS :
   Let's Encrypt s'en sert pour valider le domaine (challenge HTTP-01), et
   Caddy redirige automatiquement le trafic HTTP vers HTTPS.
3. **Docker** sur le VPS : installe Docker Engine + le plugin Compose
   ([doc officielle](https://docs.docker.com/engine/install/)).
4. **Cloner le dépôt** sur le VPS, copier `.env.example` en `.env`, puis
   renseigner :
   ```
   DOMAIN=amimot.tondomaine.fr
   TLS_MODE=ton-email@example.com   # email de contact Let's Encrypt (obligatoire, mais jamais publié)
   HTTP_PORT=80
   HTTPS_PORT=443
   ```
   Change aussi les secrets par défaut (`POSTGRES_PASSWORD`, `JWT_SECRET`).
5. **Lancer** :
   ```bash
   docker compose -f docker-compose.yml up -d --build
   ```
   Au premier démarrage, Caddy contacte Let's Encrypt, obtient un certificat
   valide pour `DOMAIN`, et le renouvelle ensuite automatiquement (stocké dans
   le volume `caddy_data`, persistant entre redémarrages/rebuilds). Après
   quelques secondes, `https://amimot.tondomaine.fr` doit répondre avec un
   certificat valide, sans rien configurer de plus.

## Google OAuth (optionnel)

Le code est prêt côté backend (`passport-google-oauth20`, routes
`/api/auth/google` et `/api/auth/google/callback`) mais reste désactivé
(`501 Not Implemented`) tant que `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
sont vides. Pour l'activer :

1. [Google Cloud Console](https://console.cloud.google.com/) → créer/choisir
   un projet.
2. *APIs & Services → OAuth consent screen* : type "External", renseigner nom
   de l'app + emails, scopes `email` et `profile`. En mode "Testing", ajouter
   les comptes Google autorisés à se connecter en "Test users".
3. *APIs & Services → Credentials → Create Credentials → OAuth client ID*,
   type "Web application". Dans *Authorized redirect URIs*, mettre exactement
   la valeur de `GOOGLE_CALLBACK_URL` (ex. `https://amimot.tondomaine.fr/api/auth/google/callback`).
4. Copier le Client ID / Client Secret générés dans `.env` :
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_CALLBACK_URL=https://amimot.tondomaine.fr/api/auth/google/callback
   ```
5. Redémarrer le backend — les routes Google s'activent automatiquement dès
   que ces variables sont renseignées.

## Développement sans Docker

**Backend** (nécessite un Postgres accessible en local, cf. section Tests) :
```bash
cd backend
npm install
cp .env.example .env   # ajuster DATABASE_URL vers votre Postgres local
npm run dev             # nodemon, http://localhost:3000
```

**Frontend** :
```bash
cd frontend
npm install
BACKEND_URL=http://localhost:3000 npm run dev   # http://localhost:5173
```
`vite.config.js` proxy `/api` et `/socket.io` vers `BACKEND_URL` (par défaut
`http://backend:3000`, le nom DNS Docker — à surcharger en local hors Docker).

## Tests

### Backend (Jest, TDD strict — 179 tests)

Les tests d'intégration (routes REST, `account.service.js`, jobs RGPD) tapent
une vraie base Postgres de test. Le plus simple est d'en lancer une dédiée,
séparée de celle utilisée par `docker compose` :

```bash
docker run -d --name amimot-test-postgres \
  -e POSTGRES_USER=amimot -e POSTGRES_PASSWORD=amimot -e POSTGRES_DB=amimot_test \
  -p 5433:5432 postgres:16-alpine
```

Puis, dans `backend/.env` (ou en variables d'environnement) :
```
DATABASE_URL=postgresql://amimot:amimot@localhost:5433/amimot_test
```

Appliquer le schéma une première fois :
```bash
cd backend
npx prisma migrate dev --name init
```

Lancer la suite complète :
```bash
npm test
```
(`--runInBand` est déjà dans le script `test` — les tests d'intégration
partagent une vraie base, les exécuter en parallèle provoquerait des
interférences entre suites.)

### Frontend

Pas de suite automatisée pour l'instant (squelette UI). Vérification
manuelle : lancer `docker compose up` (ou `npm run dev` en local), puis
suivre le **parcours de référence** ci-dessous.

## Parcours de référence (vérification manuelle)

1. Ouvrir l'app, entrer un nom, cliquer **Créer une partie** → écran Lobby
   avec soi-même listé comme hôte (badge HÔTE) et un code à 6 chiffres masqué.
2. Copier le lien (bouton "Copier le lien"), l'ouvrir dans un autre onglet
   avec un autre nom → rejoint la même room comme second joueur (deux
   `sessionToken` distincts en `sessionStorage`, un par onglet).
3. Cliquer **C'est parti !** (hôte) → écran Jeu avec le chrono et le bouton
   collectif.
4. Chaque joueur clique **J'ai fini !** → retour automatique au Lobby dès que
   tout le monde a cliqué (ou à l'expiration du chrono sinon).
5. Relancer une nouvelle partie depuis le Lobby.
6. Tester le popup d'erreur : rejoindre avec un code invalide, ou une room
   déjà pleine → popup générique avec bouton "Retour au menu".

## Configuration (`config/game-defaults.json`)

Toutes les valeurs par défaut (taille max de room, délais de grâce
déconnexion/reconnexion, durées RGPD, TTL de nettoyage des rooms...) vivent
dans ce fichier unique, monté en lecture seule dans le conteneur backend. Le
modifier ne nécessite pas de rebuild d'image, juste un redémarrage du service
`backend`.
