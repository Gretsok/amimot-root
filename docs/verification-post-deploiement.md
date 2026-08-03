# Vérification post-déploiement

**À faire sur le VPS après chaque mise en production**, une fois
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` terminé.

Ce document complète les suites automatisées, il ne les remplace pas : **Jest, Vitest et
Playwright valident le code ; ceci valide le déploiement.** Un code parfait tourne mal avec
une variable d'environnement oubliée, une migration non appliquée ou un conteneur qui
redémarre en boucle — et c'est exactement ce qu'on cherche ici.

---

## 1. Le script

```bash
cd /chemin/vers/amimot
bash deploy/smoke-test.sh amimot.fergalmechin.fr
```

Le domaine est facultatif : sans lui, les contrôles HTTPS sont ignorés et seuls les
contrôles locaux tournent.

**Le script ne laisse rien derrière lui.** Il crée un compte de test sur une adresse en
`@example.invalid` (un domaine que la norme réserve et qui n'est jamais routable, donc aucun
mail réel n'est émis), et le supprime à la fin — y compris si un contrôle échoue en cours de
route ou si tu fais `Ctrl-C`.

Il sort en code 0 si tout passe, sinon avec le nombre d'échecs.

### Ce qu'il contrôle

| # | Section | Ce qui est vérifié |
|---|---|---|
| 1 | Conteneurs | Les trois services tournent ; le backend n'a **jamais redémarré** (un conteneur qui plante et repart paraît sain à l'instant T — c'est le compteur qui le trahit) |
| 2 | Backend | `/healthz` répond ; **migrations Prisma à jour** ; l'API répond à travers le proxy |
| 3 | Site public | HTTPS, en-tête HSTS, redirection depuis HTTP, et **repli SPA** sur les six routes clientes (sans lui, un lien direct vers la politique de confidentialité renvoie 404) |
| 4 | Comptes | Inscription ; mot de passe trop court refusé ; inscription sans acceptation refusée ; profil ; export RGPD **sans empreinte de mot de passe** et **avec** sa note d'information |
| 5 | Sessions | Un jeton **rejoué après déconnexion est refusé** — effacer le cookie ne suffisait pas historiquement |
| 5 bis | Mot de passe | Le changement exige une session ; **l'ancienne route de changement direct ne répond plus** ; la demande crée bien un jeton |
| 5 ter | Confirmation | Le statut est exposé au client ; le renvoi exige une session ; un jeton forgé est refusé |
| 6 | Email | SMTP réellement configuré ; demande de réinitialisation acceptée ; **réponse rigoureusement identique pour une adresse inconnue** ; aucune erreur d'envoi dans les journaux |
| 7 | Journaux | Rotation active sur les trois conteneurs (ils contiennent des adresses IP) |
| 8 | Effacement | Suppression du compte, et compte devenu inaccessible ensuite |

---

## 2. Contrôles manuels

Ce que le script ne peut pas faire : recevoir un mail, jouer une partie, lire une page rendue
côté client. Comptez dix minutes.

### 2.1 Réception réelle d'un email — le seul contrôle bout en bout

Le script vérifie que le serveur **accepte** la demande, pas que le message **arrive**. Il y
a maintenant deux messages à recevoir, et le premier arrive tout seul.

**Confirmation d'adresse**

1. Crée un compte avec une adresse réelle que tu relèves. La modale doit annoncer
   « Compte créé » et citer l'adresse.
2. **Le mail doit arriver en quelques secondes**, expéditeur
   `amimot-assistance@fergalmechin.fr`. Regarde aussi dans les indésirables : s'il y atterrit,
   reprendre [ovh-email-setup.md](ovh-email-setup.md).
3. Sur `/compte`, avant d'ouvrir le lien : la bannière « adresse non confirmée » et la pastille
   rouge doivent être visibles.
4. Ouvre le lien → « Ton adresse est confirmée », et la pastille passe au vert.
5. **Rouvre le même lien** : il doit être refusé (usage unique).

**Nouveau mot de passe — les deux entrées mènent au même message**

6. Depuis `/compte`, section « Mot de passe » : clique sur « M'envoyer le lien ».
   **Si l'envoi échoue, l'écran te le dit** — c'est le seul parcours de mail qui remonte
   ses erreurs, et donc le plus simple pour diagnostiquer un SMTP en panne.
7. Ouvre le lien reçu → choisis un nouveau mot de passe → connecte-toi avec.
8. **Rouvre le même lien** : il doit être refusé.
9. Déconnecte-toi, puis « Mot de passe oublié ? » avec cette adresse : le message reçu doit
   être **le même** qu'à l'étape 6, sa rédaction devant convenir aux deux cas.

### 2.2 Réception sur l'adresse de contact RGPD

Envoie un message depuis une adresse externe vers `amimot-assistance@fergalmechin.fr` et
vérifie qu'il arrive. C'est l'unique voie d'exercice des droits publiée dans la politique de
confidentialité : une adresse qui ne relève pas est un manquement à l'article 12.

### 2.3 Une partie complète, à deux navigateurs

Le temps réel (Socket.io) n'est pas couvert par le script. Ouvre deux fenêtres, dont une en
navigation privée :

- création d'une partie, code d'invitation, arrivée du second joueur ;
- une manche entière : préparation → proposition → **les deux rythmes de révélation** →
  récap des points → boutique ;
- **ferme brutalement un onglet et rouvre-le** : le joueur doit retrouver sa partie (la
  reconnexion passe par le jeton de session).

### 2.4 Pages légales et espace compte

Sur `https://amimot.fergalmechin.fr`, **sans être connecté** :

- `/confidentialite` — le contenu s'affiche, le SIREN et l'adresse de contact y figurent ;
- `/mentions-legales` — éditeur et hébergeur visibles ;
- les deux liens du pied de page mènent bien à ces pages.

Connecté, sur `/compte` : les quatre sections s'affichent, dont **Connexions** qui ne doit pas
rester vide, et « Télécharger mes données » produit bien un fichier.

Toujours sur `/compte`, la section **Mot de passe** ne doit offrir qu'un bouton d'envoi et
afficher l'adresse concernée — aucun champ de mot de passe, aucun lien « mot de passe
oublié ». Un compte créé via Google ne doit pas voir cette section du tout.

Enfin, **supprime un compte de test** et vérifie que le mail de confirmation arrive.

---

## 3. En cas d'échec

| Symptôme | Cause la plus fréquente | Que faire |
|---|---|---|
| `conteneur X` absent ou arrêté | Variable d'environnement manquante au démarrage | `docker compose logs X --tail 50` |
| `backend a redémarré N fois` | Boucle de plantage, souvent `JWT_SECRET` absent ou base injoignable | `docker compose logs backend` |
| `migrations en retard` | Image reconstruite sans redémarrer, ou migration échouée | `docker compose restart backend` puis relire les journaux |
| `HSTS absent` | En-tête perdu par le nginx de l'hôte | Vérifier que le proxy relaie les en-têtes du conteneur |
| `/confidentialite` en 404 | Repli SPA cassé | Vérifier `try_files {path} /index.html` dans `deploy/Caddyfile.prod` |
| `SMTP non configuré` | Variables absentes **ou conteneur non redémarré depuis** | Compléter le `.env` puis `docker compose up -d backend` |
| `le mailer est resté inerte` | Le `.env` a changé sans recréer le conteneur | `docker compose up -d --force-recreate backend` |
| `réponse différente pour une adresse inconnue` | **Régression sérieuse** | Le point d'entrée révèle qui a un compte — à corriger avant d'ouvrir au public |
| `jeton rejoué accepté` | **Régression sérieuse** | La déconnexion n'est plus opposable ; vérifier `tokenVersion` |
| `l'ancien changement direct n'existe plus` en échec | La route `/auth/change-password` répond encore | Le contournement du passage par mail subsiste — à retirer |
| Mail de confirmation jamais reçu | Envoi best-effort : l'inscription réussit même si le SMTP échoue | `docker compose logs backend \| grep "confirmation d'adresse"` |
| **Aucun mail de mot de passe reçu** | Trois causes possibles, toutes silencieuses jusqu'ici | Voir la section 3 bis ci-dessous |
| `rotation des journaux` absente | Conteneurs créés avant l'ajout dans `docker-compose.yml` | `docker compose up -d --force-recreate` |

Les lignes marquées « régression sérieuse » sont des défauts de confidentialité au sens
de l'article 32 : ils ont déjà été corrigés une fois
([audit](rgpd-audit-2026-08.md)), leur retour justifie de ne pas déployer.

---

## 3 bis. Aucun mail de mot de passe ne parvient

Ce parcours a été muet pendant tout un déploiement : le serveur répond 204 quoi qu'il arrive
— délibérément, pour ne pas révéler qui a un compte — et l'écran annonçait « lien envoyé »
même sur échec ([audit §G6](rgpd-audit-2026-08.md)). Il est désormais observable, mais la
lecture reste indirecte. Dans l'ordre :

**1. Le SMTP est-il seulement joignable ?** Le backend le dit au démarrage :

```bash
docker compose logs backend | grep '\[mailer\]'
```

`SMTP joignable` → passer au point 2. `INJOIGNABLE` ou `non configuré` → le problème est là,
rien d'autre à chercher.

**2. Est-ce le limiteur ?** Déclencher une demande et lire le code de retour :

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST https://amimot.fergalmechin.fr/api/auth/forgot-password -H 'Content-Type: application/json' -d '{"email":"ton.adresse@example.com"}'
```

`429` → limiteur saturé. Vérifier `TRUST_PROXY_HOPS` : s'il est trop bas pour la topologie
réelle, `req.ip` vaut l'IP d'un proxy et le budget de 20 requêtes / 10 min est **partagé par
tous les visiteurs** au lieu d'être par IP. Derrière le nginx de l'hôte **et** Caddy, il faut
`TRUST_PROXY_HOPS=2`.

**3. Le compte a-t-il bien été trouvé ?**

```bash
docker compose logs --tail 50 backend
```

`adresse sans compte local` → l'adresse est inconnue, ou le compte est un compte Google, qui
n'a pas de mot de passe. `échec de la demande` → l'envoi a échoué, avec sa cause.

**Raccourci :** la demande depuis `/compte` (« M'envoyer le lien ») emprunte exactement la
même machinerie mais **remonte ses erreurs à l'écran**, puisque l'appelant est authentifié et
qu'il n'y a alors aucun oracle à protéger. C'est le moyen le plus rapide de voir la cause
réelle sans lire de journaux.

---

## 4. Au premier déploiement seulement

- [ ] **Sauvegardes de la base** — existent-elles, et une restauration a-t-elle été testée ?
      C'est le point ouvert le plus urgent, cf.
      [rgpd-conformite-operationnelle.md](rgpd-conformite-operationnelle.md) §2.
- [ ] **Rotation des journaux du nginx de l'hôte** (ceux du conteneur sont couverts par le
      script) — [`deploy/logrotate-amimot-nginx.conf`](../deploy/logrotate-amimot-nginx.conf).
- [ ] **Compte CNIL de notification** créé — cf.
      [rgpd-procedure-violation.md](rgpd-procedure-violation.md). À faire avant d'en avoir
      besoin.
- [ ] **DMARC** : durcir `p=none` → `p=quarantine` → `p=reject` après deux à quatre semaines
      de rapports propres, soit **vers le 30 août 2026**.
