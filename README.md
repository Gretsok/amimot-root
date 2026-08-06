# Amimot

Jeu de mots multijoueur dans le navigateur, façon Gartic Phone. Une partie se
joue à plusieurs dans une room rejointe par code d'invitation : **7 manches de
5 phases** (préparation → proposition → résolution → récap → boutique), avec
mots-pièges, cartes de contrainte, score et économie de pièces.

Jouer ne demande **aucun compte** : un nom d'affichage suffit. Un compte sert
uniquement à conserver un pseudo et une progression entre les parties.

## Structure du dépôt

**Trois dépôts git distincts**, pas un seul : `backend/` et `frontend/` sont de
vrais sous-modules. Une modification à l'intérieur de l'un demande donc **deux
commits** — un dans le sous-module, puis un à la racine qui déplace le pointeur.

```
amimot/
├── config/game-defaults.json   # config partagée, montée en lecture seule dans le backend
├── deploy/                     # Caddyfile de prod, script de vérification, logrotate
├── docs/                       # RGPD, mise en place email, runbook de déploiement
├── e2e/                        # suite Playwright (frontend + backend + temps réel)
├── docker-compose.yml          # stack de prod (seul le frontend publie un port)
├── docker-compose.override.yml # surcouche dev (hot-reload), fusionnée automatiquement
├── docker-compose.prod.yml     # surcouche VPS (Caddyfile bind-monté, port sur la loopback)
├── backend/                    # Express + Prisma + Socket.io — sous-module git
└── frontend/                   # React + Vite — sous-module git
```

Le détail d'architecture destiné aux contributeurs (et aux agents) vit dans
[`AGENTS.md`](AGENTS.md).

## Prérequis

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Compose v2)
- Node.js 22+ et npm, seulement pour lancer les suites de tests ou travailler
  hors Docker

## Premier démarrage

```bash
cp .env.example .env
docker compose up -d --build
```

Compose charge automatiquement `docker-compose.yml` **et**
`docker-compose.override.yml` : vous obtenez le mode dev avec hot-reload
(nodemon côté backend, Vite côté frontend), en HTTP simple sur
`http://localhost:<FRONTEND_PORT>` (5173 par défaut).

Vérifier que ça répond, puis ouvrir la même URL dans un navigateur :

```bash
curl http://localhost:<FRONTEND_PORT>/api/config/game-defaults
```

Arrêter : `docker compose down`.

> **Sous Windows**, les bind mounts ne propagent pas les événements de fichier à
> Vite : après une modification côté frontend, un `docker restart
> amimot-frontend-1` est parfois nécessaire.

## Mode « prod » en local (build statique, Caddy, HTTPS)

Pour ignorer la surcouche dev et utiliser les images de production :

```bash
docker compose -f docker-compose.yml up -d --build
```

Seul le conteneur `frontend` publie des ports (`HTTP_PORT:80`,
`HTTPS_PORT:443`) ; `backend` et `postgres` ne sont joignables que par le réseau
Docker interne. Avec les valeurs par défaut (`DOMAIN=localhost`,
`TLS_MODE=internal`), Caddy génère un certificat auto-signé — l'avertissement du
navigateur est attendu.

## Configuration

Toutes les valeurs de gameplay et de rétention (taille de room, durées de
phase, multiplicateurs, catalogue de cartes, délais de grâce, seuils RGPD…)
vivent dans [`config/game-defaults.json`](config/game-defaults.json), monté en
lecture seule dans le conteneur. Le schéma est validé au démarrage, en
échec-rapide : une clé manquante ou mal typée empêche le backend de démarrer
plutôt que de laisser la valeur se propager. Modifier ce fichier ne demande pas
de rebuild, seulement un redémarrage du service `backend`.

Les variables d'environnement sont documentées dans
[`.env.example`](.env.example). Trois méritent une attention particulière :

| Variable | Pourquoi elle compte |
|---|---|
| `SMTP_*` | Sans elles le mailer reste **inerte** : il journalise les messages au lieu de les envoyer. On peut donc jouer et développer sans compte mail. Mise en place : [docs/ovh-email-setup.md](docs/ovh-email-setup.md) |
| `TRUST_PROXY_HOPS` | Nombre de reverse proxies devant le backend. Se tromper est **silencieux** et transforme le limiteur d'authentification en budget global partagé par tous les visiteurs, au lieu d'être par IP |
| `JWT_SECRET` | Le serveur refuse de démarrer sans |

## Comptes, emails et RGPD

L'application gère des comptes (email/mot de passe ou Google), et donc des
données personnelles. Ce qui en découle :

- **Pages légales** publiques et adressables : `/confidentialite` et
  `/mentions-legales`.
- **Espace compte** sur `/compte` : pseudo, moyens de connexion, export des
  données (art. 20), suppression (art. 17).
- **Emails transactionnels uniquement** — confirmation d'adresse à
  l'inscription, lien pour définir un nouveau mot de passe, préavis 30 jours
  avant suppression pour inactivité, confirmation après suppression. Aucun envoi
  promotionnel.
- **Le mot de passe ne se change que par email**, y compris depuis un compte
  connecté : prouver qu'on relève l'adresse vaut mieux que prouver qu'on connaît
  le mot de passe actuel.
- **Purge automatique** des comptes inactifs après 760 jours, avec préavis à 730.

Les données de partie (mots proposés, mots-pièges, cartes, scores) **ne sont
jamais écrites en base** : elles vivent en mémoire le temps de la partie. Seuls
les comptes le sont.

Documentation associée : [audit RGPD](docs/rgpd-audit-2026-08.md),
[registre des traitements](docs/rgpd-registre-traitements.md),
[procédure de violation](docs/rgpd-procedure-violation.md),
[conformité opérationnelle](docs/rgpd-conformite-operationnelle.md).

## Déployer sur un VPS

1. **Domaine** : un enregistrement DNS `A` vers l'IP publique du VPS.
2. **Pare-feu** : ports 80 et 443 ouverts (`ufw allow 80,443/tcp`, plus le
   firewall OVH si vous en avez un). Le 80 doit rester ouvert même en HTTPS
   seul : Let's Encrypt s'en sert pour le challenge HTTP-01.
3. **Docker Engine + plugin Compose** sur le VPS.
4. **Cloner le dépôt** (`--recurse-submodules`), copier `.env.example` en `.env`,
   renseigner `DOMAIN`, `TLS_MODE` (email de contact Let's Encrypt), les secrets
   Postgres/JWT, et le SMTP si vous voulez les emails.
5. **Lancer** :
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```

Les migrations Prisma s'appliquent au démarrage du conteneur backend, via son
`CMD` — il n'y a pas d'étape manuelle.

> **Un changement de variable d'environnement demande
> `--force-recreate <service>`**, pas un simple `restart` : `restart` ne
> recharge pas l'environnement.

### La topologie réelle diffère du cas simple

Sur le VPS d'origine, un **nginx d'hôte** (TLS géré par Certbot) est placé
devant le conteneur Caddy et lui transmet le trafic sur `127.0.0.1:8081`. Cette
couche vit en dehors du dépôt. Deux conséquences :

- C'est [`deploy/Caddyfile.prod`](deploy/Caddyfile.prod) qui est bind-monté en
  production, **pas** `frontend/Caddyfile` — ce dernier ne sert qu'au chemin
  « image seule ». Tout correctif Caddy doit aller dans le premier.
- Il y a **deux** proxies devant Express, d'où `TRUST_PROXY_HOPS=2`.

### Après chaque déploiement

```bash
bash deploy/smoke-test.sh amimot.example.fr
```

36 contrôles : conteneurs, migrations, repli SPA, parcours de compte, révocation
de session, emails, rotation des journaux, effacement. Le script crée un compte
de test sur une adresse en `@example.invalid` (jamais routable) et le supprime à
la fin, y compris en cas d'échec ou de `Ctrl-C`.

Les contrôles qui demandent un navigateur ou une boîte mail restent à faire à la
main : [docs/verification-post-deploiement.md](docs/verification-post-deploiement.md).
Ce document contient aussi un **arbre de décision** pour le cas « aucun mail de
mot de passe n'arrive », qui a déjà coûté un déploiement.

## Google OAuth (optionnel)

Les routes `/api/auth/google*` répondent `501` tant que `GOOGLE_CLIENT_ID` et
`GOOGLE_CLIENT_SECRET` sont vides, et s'activent dès qu'elles sont renseignées.

1. [Google Cloud Console](https://console.cloud.google.com/) → créer ou choisir
   un projet.
2. *APIs & Services → OAuth consent screen* : type « External », nom de l'app,
   emails, scopes `email` et `profile`. En mode « Testing », ajouter les comptes
   autorisés dans « Test users ».
3. *Credentials → Create Credentials → OAuth client ID*, type « Web
   application ». Dans *Authorized redirect URIs*, mettre **exactement** la
   valeur de `GOOGLE_CALLBACK_URL`.
4. Reporter le Client ID / Secret dans `.env`, puis recréer le conteneur backend.

## Développement hors Docker

**Backend** (nécessite un Postgres joignable, cf. Tests) :
```bash
cd backend
npm install
cp .env.example .env    # ajuster DATABASE_URL
npm run dev             # nodemon, http://localhost:3000
```

**Frontend** :
```bash
cd frontend
npm install
BACKEND_URL=http://localhost:3000 npm run dev   # http://localhost:5173
```
`vite.config.js` proxie `/api` et `/socket.io` vers `BACKEND_URL` (par défaut
`http://backend:3000`, le nom DNS Docker — à surcharger hors Docker).

## Tests

Trois suites, à lancer séparément — il n'existe pas de commande unique.

### Backend — Jest, 499 tests

Cinq fichiers ont besoin d'un **vrai Postgres sur `localhost:5433`** (comptes,
auth, purge RGPD). Sans lui, chacun attend ~60 s l'expiration d'un délai Prisma
avant d'échouer : `npm test` peut sembler figé plusieurs minutes alors qu'il
avance.

```bash
docker run -d --name amimot-test-postgres \
  -e POSTGRES_USER=amimot -e POSTGRES_PASSWORD=amimot -e POSTGRES_DB=amimot_test \
  -p 5433:5432 postgres:16-alpine

cd backend
echo 'DATABASE_URL=postgresql://amimot:amimot@localhost:5433/amimot_test' >> .env
npx prisma migrate deploy
npm test
```

`--runInBand` est déjà dans le script `test` : les tests d'intégration partagent
une vraie base et interfèreraient en parallèle.

Pour itérer sur le moteur de jeu sans base :
```bash
npx jest tests/unit
```

### Frontend — Vitest, 189 tests

```bash
cd frontend
npm test
npm run lint
```

### Bout en bout — Playwright, 48 tests

Depuis la racine. Playwright démarre lui-même un backend et un serveur Vite
(base de test sur le port 5433, comme ci-dessus) :

```bash
npm run test:e2e
npm run test:e2e:ui       # mode interactif
npm run test:e2e:report   # dernier rapport
```

La configuration de jeu utilisée par cette suite est
`e2e/fixtures/game-defaults.e2e.json`, **distincte** de celle de
`config/` : toute nouvelle clé obligatoire doit être ajoutée aux deux, sinon le
backend refuse de démarrer derrière un timeout Playwright peu explicite.
