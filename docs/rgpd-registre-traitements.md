# Registre des activités de traitement — Amimot

**Article 30 du RGPD.** Ce registre doit être tenu à jour et pouvoir être présenté à la CNIL
sur demande. Il est obligatoire dès lors que le traitement n'est pas occasionnel, ce qui est
le cas ici (un service en ligne traite en continu).

**Dernière mise à jour :** 2 août 2026
**Établi à partir de :** [rgpd-audit-2026-08.md](rgpd-audit-2026-08.md) §A, et du code au
commit courant.

> ⚠️ **À maintenir.** Ce document décrit ce que le code fait aujourd'hui. Toute nouvelle
> donnée collectée, tout nouveau destinataire, toute nouvelle durée de conservation doit y
> être reportée — sinon il devient faux, et un registre faux est pire qu'un registre absent.
> Les champs marqués **`[À COMPLÉTER]`** dépendent d'informations hors du dépôt.

---

## Responsable de traitement

| | |
|---|---|
| **Identité** | Fergal Mechin, entrepreneur individuel |
| **SIREN** | 990501405 — inscrit au Registre National des Entreprises |
| **Adresse** | `[À COMPLÉTER]` *(non publiée sur le site, cf. audit §G2 ; elle doit en revanche figurer ici)* |
| **Contact RGPD** | amimot-assistance@fergalmechin.fr |
| **Délégué à la protection des données** | Non désigné. Non obligatoire ici : ni autorité publique, ni suivi systématique à grande échelle, ni traitement à grande échelle de données sensibles (art. 37). |

---

## Traitement n° 1 — Gestion des comptes joueurs

| | |
|---|---|
| **Finalité principale** | Permettre la création d'un compte, l'authentification, la conservation d'un pseudo et d'une progression entre les parties |
| **Finalités secondaires** | Suppression des comptes devenus inactifs (minimisation) |
| **Base légale** | Exécution du contrat (art. 6.1.b) — le compte est le service demandé par la personne |
| **Personnes concernées** | Joueurs ayant volontairement créé un compte. Réservé aux 15 ans et plus (déclaration à l'inscription) |

### Catégories de données

| Donnée | Origine | Remarque |
|---|---|---|
| Adresse email | Saisie par la personne, ou transmise par Google | Identifiant de connexion et contact |
| Empreinte du mot de passe (bcrypt, coût 12) | Dérivée de la saisie | Le mot de passe en clair n'est jamais stocké |
| Identifiant du fournisseur (`providerId`) | Email en minuscules (compte local) ou identifiant `sub` (Google) | |
| Pseudo | Saisie par la personne, ou nom d'affichage Google | **Public** vis-à-vis des autres joueurs |
| Expérience (`xp`), parties jouées | Calculées en fin de partie | Alimentées uniquement pour les joueurs connectés |
| Statut du compte (actif / suspendu / banni) | Modération | |
| Dates de création, de mise à jour, de dernière connexion | Automatiques | Servent au calcul d'inactivité |
| Version de jeton (`tokenVersion`) | Automatique | Technique : permet de révoquer les sessions |
| Date d'acceptation de la politique (`policyAcceptedAt`) | Automatique à l'inscription | Preuve de l'information délivrée (art. 12-13) |
| Jeton de réinitialisation de mot de passe | Créé à la demande | **Empreinte seule**, jamais le jeton ; expire en 60 min, usage unique, supprimé par la purge quotidienne dès qu'il est expiré ou consommé |

**Aucune donnée sensible** au sens de l'article 9 n'est collectée. Aucune donnée de paiement.
Aucun profilage ni décision automatisée au sens de l'article 22.

### Destinataires

| Destinataire | Rôle | Données concernées |
|---|---|---|
| Fergal Mechin (responsable) | Administration du service | Toutes |
| OVH SAS — 2 rue Kellermann, 59100 Roubaix, France | Sous-traitant : hébergement **et messagerie sortante** (réinitialisation de mot de passe) | Toutes (au repos et en transit) ; adresse email pour les envois |
| Google `[À COMPLÉTER : entité exacte]` — pour les utilisateurs de l'UE, il s'agit en principe de Google Ireland Ltd., à confirmer dans les conditions applicables | Fournisseur d'identité, **uniquement si** la personne choisit la connexion Google | Identifiant Google, email, nom d'affichage |

### Transferts hors UE

Hébergement en France (OVHcloud). Pour la connexion Google, un transfert hors UE est
possible dans le cadre des conditions de Google ; il repose sur les mécanismes déclarés par
Google (clauses contractuelles types et/ou EU-US Data Privacy Framework). `[À COMPLÉTER]` :
vérifier et archiver la référence exacte du mécanisme invoqué par Google.

### Durée de conservation

- **Compte actif** : conservé tant que la personne l'utilise.
- **Compte inactif** : supprimé automatiquement après **760 jours** sans connexion. La purge
  s'exécute une fois par jour (`backend/src/jobs/rgpd-purge.job.js`).
- **Suppression demandée** : immédiate et définitive, en base, via l'espace compte. Les
  moyens de connexion liés sont supprimés en cascade.
- **Aucun préavis n'est envoyé avant la suppression pour inactivité** (le service n'envoie
  aucun email). Cette suppression est annoncée à l'inscription, dans l'espace compte et dans
  la politique de confidentialité.
- `[À COMPLÉTER]` — **Sauvegardes** : si des sauvegardes de la base existent, indiquer leur
  rétention et confirmer que la suppression s'y propage. Sans cela, le droit à l'effacement
  n'est pas effectif.

---

## Traitement n° 2 — Déroulement des parties

| | |
|---|---|
| **Finalité** | Faire fonctionner le jeu : afficher les joueurs présents, valider les mots, calculer les scores |
| **Base légale** | Exécution du contrat (art. 6.1.b) — c'est le service lui-même |
| **Personnes concernées** | Tous les joueurs, **avec ou sans compte** |

### Catégories de données

Nom affiché choisi pour la partie, identifiant technique de joueur, horodatage de connexion,
état de connexion, mots proposés et mots-pièges, cartes en main, scores et pièces.

### Particularité déterminante

**Ces données ne sont jamais écrites en base.** Elles vivent exclusivement en mémoire vive du
processus serveur, le temps de la partie
(`backend/src/stores/rooms.store.js`, `gamestate.store.js`). Elles sont détruites à la
fermeture de la room, au plus tard par la tâche de nettoyage
(`room-cleanup.job.js`) qui supprime toute room inactive depuis plus de **3 heures**.

Conséquences à assumer dans les réponses aux personnes : ces données **ne sont pas
exportables** (il n'y a rien à exporter une fois la partie finie) et **ne survivent pas** à
un redémarrage du serveur.

### Destinataires

Les autres joueurs de la même partie voient le nom affiché, l'état de connexion, les mots
révélés et les scores — c'est le principe du jeu. Aucune transmission externe.

### Durée de conservation

Le temps de la partie, plus au maximum 3 heures pour une room abandonnée.

---

## Traitement n° 3 — Sécurité du service et lutte contre les abus

| | |
|---|---|
| **Finalité** | Limiter le nombre de requêtes par origine (anti-force brute sur les mots de passe et les codes d'invitation), diagnostiquer les incidents |
| **Base légale** | Intérêt légitime (art. 6.1.f) — assurer la sécurité et la disponibilité du service. L'intérêt des personnes est préservé : la donnée n'est ni durablement conservée, ni utilisée à d'autres fins |
| **Personnes concernées** | Tout visiteur, avec ou sans compte |

### Catégories de données

| Donnée | Usage |
|---|---|
| Adresse IP | Clé de comptage des requêtes, dans une fenêtre glissante en mémoire (`backend/src/sockets/rate-limiter.js`, `middlewares/rate-limit.middleware.js`) |
| Journaux techniques (erreurs serveur) | Diagnostic. Réduits à `name`, `code`, `message`, `stack` — les paramètres de requête, qui pouvaient contenir un email, en sont exclus (`middlewares/error.middleware.js`) |
| Journaux d'accès du reverse proxy | Contiennent des adresses IP. `[À COMPLÉTER]` — rétention réelle côté hôte |

### Durée de conservation

- Compteurs de limitation : quelques minutes en mémoire, jamais écrits sur disque.
- Journaux des conteneurs : rotation configurée à 3 fichiers de 10 Mo par service
  (`docker-compose.yml`), soit une fenêtre glissante récente.
- Journaux du reverse proxy de l'hôte : `[À COMPLÉTER]` — cf.
  [rgpd-conformite-operationnelle.md](rgpd-conformite-operationnelle.md).

---

## Mesures de sécurité (art. 32) — description générale

| Domaine | Mesure |
|---|---|
| Mots de passe | bcrypt coût 12 ; minimum 12 caractères ; rejet des mots de passe très courants |
| Sessions | Jeton JWT de 7 jours, cookie `httpOnly` + `SameSite=Lax` + `Secure` en production ; révocation effective à la déconnexion via `tokenVersion` |
| Sessions de partie | Jeton de reprise distinct de l'identifiant de joueur, jamais diffusé, révoqué au départ du joueur |
| Chiffrement en transit | HTTPS, HSTS (`max-age=31536000; includeSubDomains`) |
| Exposition réseau | Base de données et backend sans port publié ; seul le frontend est exposé |
| En-têtes | `helmet()` (valeurs par défaut) ; CORS restreint aux origines déclarées |
| Anti-abus | Limitation de débit sur l'authentification (20 / 10 min), la résolution d'invitation (30 / min) et les actions de jeu |
| Contrôle d'accès | Politique déclarative centralisée (`domain/permissions/`) ; vérification de propriété sur les opérations destructrices |
| Journalisation | Réduction volontaire des données journalisées ; rotation configurée |
| Secrets | Variables d'environnement ; le serveur refuse de démarrer sans `JWT_SECRET` |
| Tests | Suites automatisées couvrant les régressions de sécurité identifiées lors de l'audit |
| Chiffrement au repos | `[À COMPLÉTER]` — dépend de la configuration du volume et de l'offre OVH |
| Sauvegardes | `[À COMPLÉTER]` |
