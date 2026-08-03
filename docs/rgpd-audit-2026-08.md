# Audit RGPD — Amimot

**Date :** 2 août 2026
**Périmètre :** dépôts `backend`, `frontend`, racine (`config/`, `deploy/`, `docker-compose*.yml`)
**Méthode :** lecture du code et de la configuration, plus une sonde exécutée sur une instance
locale de développement pour vérifier le constat le plus grave (§C1).

> **Avertissement.** Cet audit porte sur ce que le code fait. Il ne remplace pas un avis
> juridique et ne couvre pas ce qui vit hors du dépôt : hébergeur réel, sauvegardes,
> journaux du reverse proxy de l'hôte, engagements contractuels, registre des traitements.
> Ces points sont listés en §F comme questions ouvertes, pas comme conformités.

> **📌 Mise à jour du 2 août 2026 (soir).** Les onze constats ont été traités. L'état de
> chacun figure dans la colonne « État » ci-dessous, et le détail des corrections en
> [§G](#g). **Deux écarts subsistent volontairement** — l'absence d'adresse et de téléphone
> dans les mentions légales ([§G2](#g2)), et l'absence de préavis avant suppression pour
> inactivité ([§G3](#g3)).
>
> **Documents produits en complément :**
> - [rgpd-registre-traitements.md](rgpd-registre-traitements.md) — registre des activités de
>   traitement (art. 30), à tenir à jour.
> - [rgpd-procedure-violation.md](rgpd-procedure-violation.md) — que faire en cas de
>   violation de données, et dans quel délai (art. 33-34).
> - [rgpd-conformite-operationnelle.md](rgpd-conformite-operationnelle.md) — ce qui reste à
>   faire hors du dépôt : sous-traitance OVH, **sauvegardes**, journaux de l'hôte.

---

## Synthèse

| Gravité | Constat | État |
|---|---|---|
| 🔴 Critique | [C1](#c1) Le jeton de session vaut l'identifiant de joueur, diffusé à toute la room → n'importe qui peut reprendre la session d'un autre joueur | ✅ Corrigé |
| 🔴 Critique | [C2](#c2) Aucune information des personnes : ni politique de confidentialité, ni mentions légales, ni base légale annoncée | ✅ Corrigé (écart LCEN assumé, [§G2](#g2)) |
| 🟠 Important | [C3](#c3) `unlinkAccount` ne vérifie pas que le compte à délier appartient à l'utilisateur | ✅ Corrigé |
| 🟠 Important | [C4](#c4) La notification avant suppression pour inactivité n'est jamais envoyée | ⚠️ Arbitré autrement ([§G3](#g3)) |
| 🟠 Important | [C5](#c5) Le journal d'erreur 500 imprime l'objet d'erreur brut, qui peut contenir des données personnelles | ✅ Corrigé |
| 🟠 Important | [C6](#c6) Aucune politique de mot de passe | ✅ Corrigé |
| 🟡 Moyen | [C7](#c7) `anonymousLogRetentionDays` est validé au démarrage mais n'est branché sur rien | ✅ Corrigé |
| 🟡 Moyen | [C8](#c8) L'export de données omet des données réellement détenues | ✅ Corrigé |
| 🟡 Moyen | [C9](#c9) Email jamais vérifié, et aucune procédure de récupération de compte | ◐ Récupération **faite** ; vérification d'email toujours reportée ([§G4](#g4)) |
| 🟡 Moyen | [C10](#c10) Durée de session de 30 jours non révocable côté serveur | ✅ Corrigé |
| 🟢 Mineur | [C11](#c11) `xp` / `gamesPlayed` collectés dans le schéma mais jamais alimentés | ✅ Corrigé |

**Ce qui est déjà bien fait**, et qui mérite d'être noté parce que c'est rare à ce stade
d'un projet : droit à l'effacement (`DELETE /api/account/me`) et droit à la portabilité
(`GET /api/account/me/export`) sont implémentés, exposés dans l'interface et testés ; la
suppression cascade correctement sur les comptes liés ; le `passwordHash` est explicitement
exclu de l'export ; les mots de passe sont hachés avec bcrypt ; le cookie de session est
`httpOnly` + `sameSite=lax` + `secure` en production ; aucun outil d'analytics, aucun
traqueur, aucune police ou script tiers — les dépendances front se limitent à `react`,
`react-dom` et `socket.io-client` ; et les données de jeu des joueurs anonymes ne sont
jamais persistées en base.

---

## A. Cartographie des données personnelles

### A1. Données persistées (PostgreSQL, via Prisma)

`backend/prisma/schema.prisma`

| Modèle | Champ | Nature | Commentaire |
|---|---|---|---|
| `Account` | `email` | Donnée identifiante directe | Collectée pour LOCAL et GOOGLE |
| `Account` | `providerId` | Email (LOCAL) ou `sub` Google (GOOGLE) | Identifiant tiers |
| `Account` | `passwordHash` | Secret d'authentification | bcrypt, coût 10 |
| `Account` | `createdAt` / `updatedAt` / `lastLoginAt` | Horodatages de connexion | Base du calcul d'inactivité |
| `User` | `pseudo` | Pseudonyme public, unique | Fourni librement ; en OAuth, **rempli avec le `displayName` Google**, qui est très souvent le nom civil réel |
| `User` | `xp`, `gamesPlayed` | Données de jeu | Jamais alimentées, cf. [C11](#c11) |
| `User` | `status` | ACTIVE / SUSPENDED / BANNED | Donnée de modération |

### A2. Données en mémoire vive uniquement (jamais en base)

`backend/src/stores/rooms.store.js`, `gamestate.store.js` — `displayName` choisi pour la
partie, identifiants de joueur, horodatage de connexion, mots-pièges et propositions,
main de cartes, scores. Détruites à la fin de la room (`room-cleanup.job.js`). C'est un bon
choix de minimisation ; il est important qu'il reste documenté comme tel.

### A3. Données transitoires côté client

`frontend/src/utils/storage.js` — `sessionStorage` uniquement (jeton de session de room,
données de partie), effacé à la fermeture de l'onglet. `localStorage` n'est utilisé nulle
part. Le cookie `token` (JWT, 30 jours) est le seul stockage persistant.

### A4. Adresses IP

`backend/src/sockets/rate-limiter.js` lit l'IP (`x-forwarded-for` ou adresse du handshake)
et s'en sert comme clé de limitation de débit ; `express-rate-limit` fait de même côté REST.
Ces IP restent en mémoire, dans une fenêtre glissante, et ne sont jamais écrites sur disque
par l'application. C'est un traitement légitime (sécurité, intérêt légitime) mais **non
mentionné aux personnes**, cf. [C2](#c2).

### A5. Destinataire tiers

Google (OAuth 2.0), via `passport-google-oauth20`, portée `['profile', 'email']`. Un
transfert hors UE est probable et n'est ni encadré ni annoncé dans le produit.

---

## B. Droits des personnes

| Droit | État | Où |
|---|---|---|
| Information (art. 13-14) | ❌ **Absent** | cf. [C2](#c2) |
| Accès (art. 15) | ⚠️ Partiel | `GET /api/account/me` + export, mais incomplet, cf. [C8](#c8) |
| Rectification (art. 16) | ⚠️ Partiel | `PATCH /api/account/me` ne permet de corriger que le pseudo, **pas l'email** |
| Effacement (art. 17) | ✅ | `DELETE /api/account/me`, cascade sur `Account`, cookie invalidé |
| Portabilité (art. 20) | ⚠️ Partiel | `GET /api/account/me/export`, JSON structuré et lisible, mais incomplet |
| Opposition / limitation (art. 18, 21) | ❌ Absent | Aucun mécanisme, aucun contact |
| Décision automatisée (art. 22) | N/A | Aucun profilage |

---

## C. Constats détaillés

### <a name="c1"></a>C1 — 🔴 Le jeton de session de room est public

**Où :** `backend/src/sockets/handlers/room.handlers.js:82` et `:117` (`sessionToken: playerId`),
`backend/src/stores/rooms.store.js:308-316` (le snapshot expose `players[].id`),
`backend/src/sockets/helpers.js:93-98` (ce snapshot est diffusé à toute la room),
`room.handlers.js:125-131` (`room:reconnect` n'exige rien d'autre).

Le jeton remis au client pour se reconnecter **est** l'identifiant du joueur. Or cet
identifiant figure dans la liste des joueurs diffusée à tous les participants de la room.
Toute personne présente dans la room — et toute personne à qui ces identifiants sont
relayés — peut donc se présenter comme un autre joueur.

**Vérifié sur instance locale** (sonde `probe-session.js`) : un troisième socket, qui n'a
ni créé ni rejoint la room, se reconnecte avec l'identifiant d'Alice lu dans
`room.players`, obtient son identité, **et lit son état privé** — mot-piège et main de
cartes :

```
id d'Alice visible par Bob dans room.players : uDLxpY2uTSomHSRxgKdqL
=> Bob connaît-il le jeton d'Alice sans jamais l'avoir reçu ? true
mot-piège réel d'Alice : "Yecret"
[reprise de session avec l'id d'Alice]
  ack ok ?               : true
  identité obtenue       : Alice
  mot-piège d'Alice lu ? : "Yecret"
  main d'Alice lue ?     : [{"instanceId":"...","type":"MIN_LENGTH"}]
=> SESSION D'AUTRUI REPRISE PAR UN TIERS ? true
```

Au-delà du RGPD (art. 32 : confidentialité), c'est aussi un défaut de jeu — on peut lire le
mot-piège de ses adversaires — et une usurpation d'identité : l'attaquant peut agir en tant
qu'hôte et arrêter la partie de tout le monde.

**Correction :** dissocier les deux notions. Générer à la création/à la jointure un secret
de session distinct (`generateId()`), le renvoyer uniquement dans l'ack privé, ne le
diffuser jamais, et le comparer dans `room:reconnect`. L'identifiant de joueur peut rester
public — c'est le jeton qui ne doit pas l'être.

### <a name="c2"></a>C2 — 🔴 Aucune information des personnes

Aucune politique de confidentialité, aucune mention légale, aucune information sur les
cookies, aucun responsable de traitement identifié, aucun contact pour exercer ses droits,
aucune base légale annoncée. Recherche exhaustive dans `frontend/src` et
`frontend/index.html` : les seules occurrences sont le libellé du bouton
« Exporter mes données (RGPD) » et un commentaire de code.

Le formulaire d'inscription (`frontend/src/components/Account/AuthOverlay.jsx`) collecte
email, mot de passe et pseudo **sans aucune mention** de ce qu'ils deviennent, de la durée
de conservation, ni du fait qu'un compte inactif sera supprimé au bout de 760 jours.

C'est le manquement le plus large de cet audit : les articles 12 et 13 imposent une
information au moment de la collecte, et elle est ici totalement absente. À minima :

- une page « Confidentialité » listant les données de §A, les finalités, les bases légales
  (contrat pour le compte, intérêt légitime pour la limitation de débit), les durées de
  conservation, les destinataires (Google), et les droits + un contact ;
- un lien vers cette page depuis le formulaire d'inscription et depuis le pied de page ;
- une mention explicite de la suppression pour inactivité au moment de l'inscription.

Le cookie `token` étant strictement nécessaire au fonctionnement du service, il ne
nécessite pas de bandeau de consentement — mais il doit être **décrit** dans cette page.

### <a name="c3"></a>C3 — 🟠 `unlinkAccount` ne vérifie pas la propriété du compte

**Où :** `backend/src/services/account.service.js:67-75`

```js
async function unlinkAccount({ userId, accountId }) {
  const count = await prisma.account.count({ where: { userId } });
  if (count <= 1) throw new LastAccountError(...);
  await prisma.account.delete({ where: { id: accountId } });   // <- userId jamais vérifié
}
```

Le garde-fou « ne pas délier le dernier moyen de connexion » compte les comptes de
*l'appelant*, puis supprime l'`accountId` **demandé**, quel que soit son propriétaire. Un
utilisateur ayant lié deux méthodes de connexion peut donc supprimer la méthode de
connexion d'un autre utilisateur, et lui faire perdre l'accès à son compte.

L'exploitation suppose de connaître un `accountId` d'autrui — ce sont des cuid, non
énumérables, et `GET /me` n'expose que les siens. Le risque est donc limité en pratique,
mais il s'agit d'un contrôle d'accès manquant sur une opération destructrice touchant les
données d'un tiers (art. 32 : intégrité).

**Correction :** `prisma.account.deleteMany({ where: { id: accountId, userId } })` et
traiter `count === 0` comme un 404.

### <a name="c4"></a>C4 — 🟠 La notification avant suppression n'est jamais envoyée ✅ résolu (§G6)

**Où :** `backend/src/jobs/rgpd-purge.job.js:20-26`, `backend/src/server.js:31-36`

La configuration prévoit deux seuils : notification à 730 jours d'inactivité, suppression à
760 (`config/game-defaults.json`). La fonction `listUsersToNotify()` est écrite et testée,
mais **n'est appelée nulle part** : la tâche planifiée n'invoque que `sweep()`. Aucune
dépendance d'envoi d'email n'existe dans `backend/package.json`.

Concrètement, un compte inactif est supprimé sans que la personne en soit prévenue, alors
que le préavis de 30 jours est manifestement le comportement voulu. La suppression pour
inactivité est une bonne pratique de minimisation, mais elle doit être annoncée — au moment
de la collecte ([C2](#c2)) **et** avant d'être exécutée.

**Correction :** brancher un envoi d'email sur `listUsersToNotify()` dans la tâche
planifiée, et mémoriser la date de notification (nouveau champ, ex. `inactivityNotifiedAt`)
pour ne pas renvoyer le message à chaque passage quotidien.

> ✅ **Fait le 3 août 2026**, exactement de cette façon — cf. [§G6](#g6). La clé de
> configuration, retirée entre-temps faute d'envoi de mail possible, a été rétablie
> maintenant qu'il y a du code derrière.

### <a name="c5"></a>C5 — 🟠 Le journal d'erreur peut contenir des données personnelles

**Où :** `backend/src/middlewares/error.middleware.js:7` — `console.error(err)`

Pour toute erreur 500, l'objet d'erreur complet est écrit dans la sortie standard, donc
dans les journaux du conteneur. Les erreurs Prisma transportent volontiers le contexte de
la requête fautive : `meta`, et pour les erreurs de validation le corps des arguments —
c'est-à-dire potentiellement un email, voire un `passwordHash`. Ces journaux n'ont par
ailleurs aucune durée de conservation définie ([C7](#c7)).

**Correction :** journaliser une forme réduite (message, `name`, `code`, pile) plutôt que
l'objet entier, et retirer explicitement `meta`/`params` des erreurs Prisma.

### <a name="c6"></a>C6 — 🟠 Aucune politique de mot de passe

**Où :** `backend/src/controllers/auth.controller.js:20-32`

`register` ne contrôle que la *présence* des champs. Un mot de passe d'un seul caractère
est accepté. Le coût bcrypt de 10 (`account.service.js:12`) est acceptable mais en deçà
des 12 aujourd'hui recommandés. L'article 32 impose des mesures adaptées au risque ; une
absence totale de contrainte sur les secrets d'authentification n'en est pas une.

**Correction :** longueur minimale de 12 caractères (recommandation CNIL pour un compte
sans mesure complémentaire), refus des mots de passe les plus courants, et passage du coût
bcrypt à 12.

### <a name="c7"></a>C7 — 🟡 Rétention des journaux : clé de configuration morte

**Où :** `config/game-defaults.json:72`, `backend/src/config/index.js:41`

`rgpd.anonymousLogRetentionDays: 30` est déclarée, validée au démarrage… et lue nulle part.
Le commentaire de `rgpd-purge.job.js` justifie l'absence de purge par le fait que rien
n'est persisté — ce qui est vrai **de l'application**, mais faux du système : les journaux
de conteneur (§C5) et ceux du reverse proxy contiennent des IP et sont conservés selon la
politique de l'hôte, pas selon cette clé.

**Correction :** soit implémenter la rotation/purge correspondante au niveau du déploiement
et documenter le lien, soit supprimer la clé pour qu'elle cesse de faire croire à une
mesure existante. La seconde option est honnête ; la première est meilleure.

### <a name="c8"></a>C8 — 🟡 L'export de données est incomplet

**Où :** `backend/src/services/account.service.js:110-133`

Tous les champs de `User` sont bien exportés. Côté `Account`, il manque `updatedAt` et
`providerId` — ce dernier étant, pour un compte Google, l'identifiant de la personne chez
le tiers, donc une donnée personnelle qui la concerne. L'exclusion de `passwordHash` est en
revanche justifiée et bien commentée.

L'article 15 porte sur *toutes* les données traitées. Il faudrait aussi que l'export
mentionne les catégories non exportables parce que non persistées (données de partie en
mémoire) et les destinataires (Google), plutôt que de laisser croire que le fichier est
exhaustif.

### <a name="c9"></a>C9 — 🟡 Email non vérifié, aucune récupération de compte

Aucune vérification d'adresse à l'inscription : n'importe qui peut créer un compte avec
l'email d'un tiers. Cela pollue la qualité des données (art. 5.1.d, exactitude) et rend la
notification de [C4](#c4) peu fiable. Aucun parcours de réinitialisation de mot de passe
n'existe non plus : un utilisateur LOCAL qui perd son mot de passe perd l'accès à ses
données, et donc la possibilité concrète d'exercer ses droits.

### <a name="c10"></a>C10 — 🟡 Session de 30 jours non révocable

**Où :** `backend/src/services/auth.service.js:5`, `backend/src/controllers/auth.controller.js:3-8`

Le JWT est valable 30 jours et n'est pas stocké côté serveur : `logout` se contente
d'effacer le cookie. Un jeton intercepté reste donc valable jusqu'à son expiration, sans
aucun moyen de le révoquer — y compris après suppression du compte, où le jeton continue de
porter un `userId` valide jusqu'à ce qu'une requête échoue en base. Durée à réduire, ou
liste de révocation à introduire.

### <a name="c11"></a>C11 — 🟢 Champs collectés jamais utilisés

`User.xp` et `User.gamesPlayed` sont déclarés, affichés dans le profil, exportés — mais
`incrementUserStats()` n'est **appelée nulle part** : ils valent toujours 0. Ce n'est pas
un manquement à la minimisation (rien n'est réellement collecté), mais un schéma qui
annonce un traitement inexistant. À brancher ou à retirer.

---

## D. Sécurité du traitement (art. 32)

**Correct :** `helmet()` avec ses valeurs par défaut ; HSTS en production
(`deploy/Caddyfile.prod:13` + helmet côté API) ; CORS restreint par `computeAllowedOrigins` ;
limitation de débit sur l'authentification (20 / 10 min), la résolution d'invitation
(30 / min) et les événements socket sensibles ; PostgreSQL sans port publié, joignable
uniquement sur le réseau interne (`docker-compose.prod.yml`) ; backend sans port publié ;
secrets par variables d'environnement, `JWT_SECRET` obligatoire au démarrage
(`server.js:13-16`) ; bcrypt pour les mots de passe.

**À corriger :** [C1](#c1) (confidentialité), [C3](#c3) (intégrité), [C5](#c5)
(journalisation), [C6](#c6) (robustesse des secrets), [C10](#c10) (révocation).

**Non vérifiable depuis le dépôt :** chiffrement au repos du volume `pgdata`, existence et
chiffrement des sauvegardes, restriction des accès administrateur à la base, journalisation
des accès.

---

<a name="e"></a>
## E. Plan d'action proposé

**Avant toute mise en production ouverte au public**

1. [C1](#c1) — Séparer le jeton de session de l'identifiant de joueur.
2. [C2](#c2) — Rédiger et publier la politique de confidentialité + les mentions légales,
   et les lier depuis le formulaire d'inscription.
3. [C3](#c3) — Ajouter le contrôle de propriété dans `unlinkAccount`.

**Ensuite**

4. [C6](#c6) — Politique de mot de passe + coût bcrypt à 12.
5. [C5](#c5) — Réduire ce qui est journalisé sur erreur 500.
6. [C4](#c4) — Brancher la notification d'inactivité (ou, à défaut d'infrastructure email,
   retirer le seuil de notification de la configuration pour ne pas annoncer une garantie
   inexistante).
7. [C9](#c9) — Vérification d'email et réinitialisation de mot de passe.
8. [C8](#c8), [C10](#c10), [C7](#c7), [C11](#c11) — Nettoyages.

**Hors code**

9. ✅ Tenir un registre des traitements (art. 30) → [rgpd-registre-traitements.md](rgpd-registre-traitements.md),
   rédigé ; quelques champs restent à compléter (adresse, sauvegardes, journaux de l'hôte).
10. ✅ Formaliser une procédure de notification de violation (art. 33-34) →
    [rgpd-procedure-violation.md](rgpd-procedure-violation.md).
11. ⬜ Vérifier le statut de l'hébergeur (sous-traitant, art. 28) et archiver l'accord →
    checklist dans [rgpd-conformite-operationnelle.md](rgpd-conformite-operationnelle.md) §1.
12. ⬜ Documenter le transfert vers Google et sa base légale → même document, §1.
13. ⬜ **Sauvegardes** : vérifier qu'elles existent, tester une restauration, fixer et
    déclarer une rétention → même document, §2. **C'est le point le plus urgent qui reste.**
14. ⬜ Rétention des journaux nginx de l'hôte → même document, §3, avec une configuration
    `logrotate` prête à installer ([deploy/logrotate-amimot-nginx.conf](../deploy/logrotate-amimot-nginx.conf)).

---

<a name="f"></a>
## F. Questions ouvertes

Ces points déterminent la conformité réelle et ne peuvent pas être tranchés depuis le code.

**Tranchés depuis :**

- ~~Qui est le responsable de traitement et quelle adresse de contact publier ?~~ → Fergal
  Mechin, entrepreneur individuel, SIREN 990501405 (RNE) ;
  `amimot-assistance@fergalmechin.fr`.
- ~~Où l'instance de production est-elle hébergée ?~~ → OVHcloud (France).
- ~~Le service est-il utilisable par des mineurs de moins de 15 ans ?~~ → Le **compte** est
  réservé aux 15 ans et plus, déclaré à l'inscription. Le jeu anonyme reste ouvert à tous,
  puisqu'il ne persiste aucune donnée : l'article 8 ne s'applique pas à ce volet.

**Toujours ouverts :**

- Un accord de sous-traitance avec OVHcloud existe-t-il et est-il archivé (art. 28) ?
- Des sauvegardes de la base existent-elles ? Si oui, avec quelle rétention — et la
  suppression d'un compte s'y propage-t-elle ? Sans cela, le droit à l'effacement n'est pas
  effectif.
- Quelle est la rétention effective des journaux du reverse proxy de l'hôte (nginx), qui
  contiennent des adresses IP ? *(Les journaux Docker, eux, ont désormais une rotation —
  cf. [C7](#c7).)*
- Le registre des traitements (art. 30) et la procédure de notification de violation
  (art. 33-34) restent à rédiger.

---

<a name="g"></a>
## G. Suite donnée — 2 août 2026

### G1. Corrections apportées

| Constat | Correction | Vérification |
|---|---|---|
| [C1](#c1) | `Player.sessionToken` distinct de `Player.id`, généré à la création/jointure, jamais inclus dans le snapshot diffusé ; `room:reconnect` résout par jeton via `getPlayerBySessionToken`, avec révocation à la sortie du joueur et à la fermeture de la room | Sonde `probe-session.js` rejouée : la reprise de session échoue là où elle livrait le mot-piège et la main. 3 tests d'intégration + 7 tests unitaires de régression |
| [C2](#c2) | Routeur (`react-router-dom`) et deux pages accessibles sans compte : `/confidentialite` et `/mentions-legales`, liées depuis le pied de l'accueil, l'espace compte et le formulaire d'inscription | 11 tests unitaires + 5 parcours E2E, dont l'accès par lien direct |
| [C3](#c3) | `unlinkAccount` filtre sur `{ id, userId }` via `deleteMany` et lève `AccountNotFoundError` si rien n'est supprimé | Test d'intégration : un attaquant à deux moyens de connexion ne peut plus supprimer celui d'un tiers |
| [C5](#c5) | `safeErrorShape` ne journalise que `name`/`code`/`message`/`stack` ; appliqué au middleware d'erreur **et** à la tâche de purge | Test unitaire : ni email ni empreinte de mot de passe ne subsistent dans la forme journalisée |
| [C6](#c6) | `domain/password.js` : 12 caractères minimum, rejet des mots de passe très courants et des caractères répétés ; coût bcrypt 10 → 12 ; règle annoncée dans le formulaire avant soumission | 7 tests unitaires + 1 test d'intégration + 1 E2E |
| [C7](#c7) | Clé morte supprimée, remplacée par la mesure réelle : rotation des journaux Docker (`json-file`, 10 Mo × 3) sur les trois services | Configuration `docker-compose.yml` |
| [C8](#c8) | Export complété (`providerId`, `updatedAt`, `policyAcceptedAt`) et objet `_informations` décrivant les données **non** persistées et les destinataires | 2 tests d'intégration + vérification du fichier réellement téléchargé |
| [C10](#c10) | `User.tokenVersion` embarquée dans le JWT et confrontée à la base par `requireAuth` ; `logout` l'incrémente ; durée 30 j → 7 j (cookie aligné) | Test d'intégration + rejeu manuel du jeton après déconnexion → 401 |
| [C11](#c11) | `incrementUserStats` appelée au passage à `ENDED`, pour les seuls joueurs authentifiés, en best-effort non bloquant | Injection optionnelle d'`accountService` dans le gestionnaire de phases |

**Espace compte** (`/compte`) — le profil, jusqu'ici une modale, devient une page adressable
regroupant Profil, Connexions, et Données et confidentialité (export, suppression, rappel
de la conservation, liens légaux).

**Information à l'inscription** — case obligatoire « J'ai 15 ans ou plus et j'ai lu la
politique de confidentialité », mention de la suppression après 760 jours, et
`User.policyAcceptedAt` horodaté côté serveur. Le serveur **refuse** de créer un compte sans
`acceptedPolicy === true` : la case n'est pas un ornement client.

<a name="g2"></a>
### G2. Écart assumé — mentions légales incomplètes

Les mentions légales publient l'éditeur, le SIREN, le RNE, le contact et l'hébergeur, mais
**ni adresse postale ni téléphone**. La LCEN (art. 6 III-1) les exige d'un éditeur
professionnel personne physique. L'omission est délibérée : l'adresse de l'entreprise est
le domicile de l'éditeur.

À noter, et c'est ce qui rend l'arbitrage moins protecteur qu'il n'y paraît : **le SIREN
publié permet déjà de retrouver l'adresse déclarée** sur `annuaire-entreprises.data.gouv.fr`.
La voie propre serait une adresse de domiciliation commerciale, publiable sans exposer le
domicile. À reprendre si le service gagne en visibilité.

<a name="g3"></a>
### G3. Reporté faute d'envoi d'email

Le service n'a aucune infrastructure d'envoi d'email, ce qui laisse trois points en suspens :

- **[C4](#c4) — préavis avant suppression pour inactivité.** Plutôt que de conserver un
  seuil de notification sans code derrière, la clé `inactiveAccountNotifyAfterDays` et
  `listUsersToNotify()` ont été **retirées** : mieux vaut ne rien promettre que promettre
  une garantie inexistante. En contrepartie, la suppression après 760 jours est désormais
  annoncée **à l'inscription**, dans l'espace compte et dans la politique de
  confidentialité. C'est ce qui rend la mesure loyale en l'absence de préavis.
- **[C9](#c9) — vérification d'email.** ✅ **Résolue depuis** — cf. [§G5](#g5).
- **[C9](#c9) — réinitialisation de mot de passe.** ✅ **Résolue depuis** — cf.
  [§G4](#g4).

<a name="g4"></a>
### G4. Envoi d'emails — mis en place le 2 août 2026 (soir)

Le domaine `fergalmechin.fr` a été authentifié (SPF déjà en place, DKIM activé, DMARC publié
en `p=none`), l'ensemble noté **10/10 par mail-tester** avec « parfaitement authentifié », et
le port 587 sortant confirmé ouvert depuis le VPS. Marche à suivre :
[ovh-email-setup.md](ovh-email-setup.md).

**Aucun sous-traitant supplémentaire** : l'envoi passe par la messagerie OVH, déjà
destinataire au [registre](rgpd-registre-traitements.md). Rien à ajouter à la politique de
confidentialité de ce côté.

**Ce que ça débloque, fait :** la **réinitialisation de mot de passe**. C'était le report le
plus gênant — sans elle, perdre son mot de passe revenait à perdre l'accès à ses données,
donc la possibilité concrète d'exercer ses droits d'accès et de portabilité.

Choix de conception, tous vérifiés par des tests :

- Le jeton n'est stocké que sous forme d'**empreinte SHA-256** : une base qui fuite ne permet
  pas de prendre le contrôle des comptes.
- **Usage unique**, expiration à 60 minutes, et toute demande ultérieure périme la
  précédente — un lien intercepté cesse d'être utilisable dès qu'on en redemande un.
- Le point d'entrée répond **exactement la même chose** pour une adresse connue, inconnue, ou
  en cas de panne SMTP : sinon il devient un moyen de savoir qui a un compte. L'interface
  respecte la même règle.
- Changer le mot de passe **révoque toutes les sessions ouvertes** (via `tokenVersion`) : si
  quelqu'un d'autre était connecté, le changement l'éjecte.
- La politique de mot de passe s'applique aussi ici — sans quoi la réinitialisation serait
  une porte dérobée pour la contourner.
- Les jetons expirés ou consommés sont supprimés par la purge quotidienne : donnée sans
  finalité, donc donnée à effacer.

**Ce qui reste ouvert :** le préavis avant suppression pour inactivité ([C4](#c4) — réglé
depuis, cf. [§G6](#g6)), et l'information individuelle des personnes en cas de violation
(art. 34), qui ne dépend plus que d'être écrite.

<a name="g5"></a>
### G5. Confirmation d'adresse et changement de mot de passe — 3 août 2026

Deux manques constatés à l'usage, tous deux dans le prolongement direct de [§G4](#g4).

**Confirmation d'adresse ([C9](#c9), art. 5.1.d — exactitude).** Un email de confirmation
part désormais à l'inscription d'un compte local. Mêmes garanties que pour la
réinitialisation : empreinte SHA-256 seule en base, usage unique, toute demande ultérieure
périmant la précédente, purge quotidienne des jetons expirés ou consommés. Trois choix
méritent d'être justifiés plutôt que subis :

- **Expiration à 7 jours**, et non 60 minutes. Ce lien n'ouvre aucun accès : il atteste
  seulement que l'adresse est relevée. Une expiration courte enverrait dans le mur qui
  relève ses messages au retour d'un week-end, sans rien protéger de plus.
- **Le jeton se consomme en POST**, jamais en GET. Les liens contenus dans un message sont
  suivis automatiquement par les antivirus et les aperçus de certains clients : un GET
  serait consommé avant que la personne n'ait cliqué.
- **Rien n'est bloqué faute de confirmation.** Le jeu reste accessible. La confirmation sert
  à garantir que la réinitialisation de mot de passe aboutira quelque part — la présenter
  comme un péage à l'entrée serait disproportionné pour un jeu de mots.

Les comptes Google sont marqués confirmés d'emblée, y compris ceux créés avant cette
migration : Google atteste déjà l'adresse.

**Changement de mot de passe depuis l'espace compte.** Il n'existait aucun moyen de changer
son mot de passe en étant connecté — seulement le parcours « mot de passe oublié », qui
suppose de passer par sa boîte mail. Le mot de passe actuel est exigé : sans cela, un poste
laissé ouvert suffirait à verrouiller le compte de son propriétaire. Le changement révoque
toutes les autres sessions (`tokenVersion`) et périme un éventuel lien de réinitialisation en
attente, mais **réémet le cookie de l'appelant** — déconnecter quelqu'un au moment précis où
il sécurise son compte serait gratuit.

**Ce que ça ne résout pas :** l'adresse n'est pas modifiable après coup, et une adresse
confirmée peut cesser d'être relevée. Le préavis avant suppression pour inactivité
([C4](#c4)) reste à écrire ; il est désormais faisable, la seule pièce qui manquait étant
l'envoi d'emails.

<a name="g6"></a>
### G6. Le mail de réinitialisation n'arrivait pas — 3 août 2026

Signalé après déploiement : le message d'inscription arrivait, celui de réinitialisation
jamais. Le SMTP fonctionnait donc, et le défaut était propre à ce chemin.

**Le vrai problème n'était pas la panne, mais le silence.** Ce parcours était muet de bout
en bout : le contrôleur répond 204 quoi qu'il arrive — délibérément, pour ne pas révéler qui
a un compte — et l'écran affichait « lien envoyé » même sur échec. Un 429 ou une erreur
d'envoi étaient donc rigoureusement invisibles, côté utilisateur comme côté journaux. Un
test défendait même explicitement ce comportement.

Corrections, indépendantes de la cause première :

- **L'interface ne ment plus.** Un 429 et une panne d'envoi sont signalés. Ni l'un ni
  l'autre ne dépend de l'existence du compte : les distinguer ne révèle rien. Seul le cas
  « adresse inconnue » reste indiscernable, et il le reste.
- **`trust proxy` était faux.** Il valait `1` avec le commentaire « Caddy est l'unique point
  d'entrée », alors que le nginx de l'hôte termine le TLS **devant** Caddy — deux sauts.
  Selon la configuration de ce nginx, `req.ip` pouvait se résoudre à une IP constante, et
  les 20 requêtes / 10 min du limiteur d'authentification devenaient alors un **budget
  global partagé par tous les visiteurs**. Rendu configurable (`TRUST_PROXY_HOPS`), à régler
  à 2 en production.
- **Le SMTP est vérifié au démarrage** et le résultat journalisé : rien ne distinguait
  « configuré » de « configuré et joignable ».
- **Le cas « aucun compte local » est journalisé** côté serveur, sans rien changer à la
  réponse HTTP. Il était jusqu'ici impossible de le distinguer d'un envoi réussi.
- **`.env.example` documente enfin les variables de mail**, qui n'y figuraient pas du tout.

<a name="g7"></a>
### G7. Le changement de mot de passe passe par le mail — 3 août 2026

La section « Mot de passe » de l'espace compte se contredisait : elle proposait un changement
direct (mot de passe actuel + nouveau) **et** un lien « mot de passe oublié » qui redemandait
l'adresse affichée juste au-dessus.

Le formulaire direct a été retiré. Le changement passe désormais par un lien envoyé à
l'adresse du compte, comme l'oubli : **prouver qu'on relève l'adresse** vaut mieux que
prouver qu'on connaît le mot de passe actuel, et c'est ce que vérifie ce détour. Un attaquant
disposant d'une session ouverte ne peut plus verrouiller le compte de sa victime ; il lui
faudrait la boîte mail — auquel cas il pouvait déjà passer par « mot de passe oublié ».

`consumePasswordReset` devient le seul chemin qui écrit un mot de passe.

**Un seul message et un seul écran** servent les deux cas, avec une rédaction neutre :
« réinitialiser » présupposait un oubli et sonnait faux pour qui vient de cliquer sur
« m'envoyer le lien » depuis son compte.

Une différence assumée entre les deux points d'entrée : la version authentifiée **dit la
vérité sur les échecs**. L'appelant est connecté, on sait déjà qu'il a un compte, il n'y a
donc aucun oracle à protéger — et cela donne enfin un chemin où une panne d'envoi est
visible sans compromettre la garantie du parcours anonyme.

<a name="g8"></a>
### G8. Mails de suppression — 3 août 2026

- **Confirmation après suppression manuelle.** Les adresses sont relevées **avant** le
  `delete` (après, il ne reste plus personne à qui écrire), et toutes celles du profil sont
  servies pour qu'un compte lié à Google soit prévenu lui aussi. Envoi best-effort : le droit
  à l'effacement prime sur la notification, une panne SMTP ne doit pas laisser en place un
  compte qu'on a demandé à supprimer.
- **Préavis à J-30 avant la purge pour inactivité** — cf. [C4](#c4). Nouveau champ
  `User.inactivityNoticeSentAt`, sans lequel le job quotidien renverrait le même
  avertissement chaque matin pendant un mois. Il est remis à null à la connexion : quelqu'un
  qui revient puis repart deux ans plus tard doit être reprévenu. L'horodatage n'est posé
  qu'**après** un envoi réussi — marquer d'abord ferait passer pour prévenu un compte qui ne
  l'a jamais été, et il serait supprimé sans avertissement.

Les trois textes affirmant qu'aucun rappel n'était envoyé (inscription, espace compte,
politique de confidentialité) ont été repris en conséquence.
