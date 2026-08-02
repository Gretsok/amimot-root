# Procédure en cas de violation de données personnelles — Amimot

**Articles 33 et 34 du RGPD.** Une violation de données doit être notifiée à la CNIL dans
les **72 heures** après en avoir pris connaissance. Ce délai est court : l'objet de ce
document est qu'il n'y ait rien à improviser le jour venu.

**Dernière mise à jour :** 2 août 2026

> Le compte à rebours de 72 heures démarre à la **prise de connaissance**, c'est-à-dire dès
> qu'il existe un degré raisonnable de certitude qu'un incident de sécurité a touché des
> données personnelles. Il ne démarre pas à la fin de l'investigation. En cas de doute,
> considérer le compteur comme lancé.

---

## Qu'est-ce qu'une violation ?

Tout incident de sécurité entraînant, de manière accidentelle ou illicite :

- la **destruction** ou la **perte** de données (base corrompue, volume effacé sans
  sauvegarde exploitable) ;
- l'**altération** non autorisée (modification de comptes par un tiers) ;
- la **divulgation** ou l'**accès** non autorisés (fuite de la base, accès administrateur
  compromis, faille exposant les données d'autres utilisateurs).

Les trois volets comptent. Une perte définitive de données **sans aucune fuite** est une
violation au même titre qu'une divulgation.

### Exemples concrets pour ce service

| Situation | Violation ? |
|---|---|
| Faille permettant de lire l'email ou le compte d'un autre utilisateur | **Oui** — divulgation |
| Faille permettant de reprendre la session d'un autre joueur *(cf. audit C1)* | **Oui** — accès non autorisé aux données de partie d'autrui |
| `JWT_SECRET` exposé (dépôt public, journal, capture d'écran) | **Oui** — permet de forger des sessions |
| Fuite de la base ou d'une sauvegarde | **Oui** |
| Accès non autorisé au serveur OVH | **Oui**, jusqu'à preuve du contraire |
| Base perdue sans sauvegarde exploitable | **Oui** — destruction |
| Faille permettant de supprimer le moyen de connexion d'autrui *(cf. audit C3)* | **Oui** — altération |
| Panne de plusieurs heures, sans accès ni perte | Non — incident de disponibilité passager |
| Un joueur voit le nom affiché des autres joueurs de sa partie | Non — c'est le fonctionnement prévu |

---

## Marche à suivre

### 1. Contenir (immédiatement)

- Couper l'accès en cause : arrêter le service si nécessaire (`docker compose down`), plutôt
  que de laisser une fuite active pendant l'investigation. Une interruption se rattrape, une
  divulgation non.
- Si des sessions peuvent être compromises : **changer `JWT_SECRET`** puis redémarrer — tous
  les jetons émis deviennent invalides.
- Si la base peut être compromise : changer `POSTGRES_PASSWORD`, et les identifiants OVH.
- Si le secret client Google peut être compromis : le régénérer dans la console Google Cloud.
- **Ne rien effacer.** Les journaux et l'état du système sont les preuves de l'investigation.
  Copier les journaux ailleurs avant toute rotation ou redémarrage.

### 2. Qualifier (dans les premières heures)

Répondre par écrit, même brièvement :

- **Quoi** — nature de la violation (confidentialité, intégrité, disponibilité).
- **Quand** — date et heure de survenance, et de la prise de connaissance.
- **Qui** — catégories et **nombre approximatif** de personnes concernées.
- **Quelles données** — email ? empreintes de mots de passe ? pseudos ? Se référer au
  [registre](rgpd-registre-traitements.md) pour l'inventaire exact.
- **Conséquences probables** pour les personnes (usurpation, réutilisation du mot de passe
  ailleurs, exposition d'une adresse email…).
- **Mesures** prises et prévues.

Ces six points sont exactement ce que demande le formulaire de la CNIL.

### 3. Notifier la CNIL — sous 72 heures

Téléservice : **<https://notifications.cnil.fr>** (compte à créer avant, pas le jour J).

- Si l'enquête n'est pas terminée : **notifier quand même**, de façon échelonnée. Un premier
  signalement incomplet dans les délais vaut mieux qu'un signalement complet hors délai.
- **Exception**, à documenter par écrit dans le registre des violations : la notification
  n'est pas requise si la violation est **peu susceptible d'engendrer un risque** pour les
  droits et libertés. Ne pas s'en saisir à la légère : dès qu'un email ou une empreinte de
  mot de passe est concerné, le risque existe.
- Au-delà de 72 heures, la notification doit être **motivée** par le retard.

### 4. Informer les personnes concernées — si risque élevé (art. 34)

Obligatoire lorsque la violation est susceptible d'engendrer un **risque élevé** : fuite
d'empreintes de mots de passe, d'adresses email en volume, ou toute donnée exploitable pour
une usurpation.

L'information doit être **directe** (email individuel) sauf effort disproportionné, auquel
cas une communication publique est admise. **Le service n'a aujourd'hui aucun moyen d'envoi
d'email** — cf. [audit §G3](rgpd-audit-2026-08.md#g3). En l'état, prévoir :

1. un bandeau ou une page d'information sur `amimot.fergalmechin.fr`, en évidence ;
2. une révocation forcée de toutes les sessions (rotation de `JWT_SECRET`) ;
3. si des mots de passe sont concernés, une invalidation des mots de passe et l'explication
   de la marche à suivre.

Le message doit indiquer, en clair et sans jargon : la nature de la violation, le contact
RGPD, les conséquences probables, les mesures prises, et **ce que la personne doit faire**
(typiquement : changer son mot de passe partout où elle l'a réutilisé).

### 5. Consigner — toujours

Toute violation doit être inscrite dans un registre interne des violations, **y compris
celles qui ne sont pas notifiées** à la CNIL. C'est ce registre qui permet de justifier une
décision de non-notification. Tableau à tenir :

| Date de survenance | Date de connaissance | Nature | Données et personnes concernées | Conséquences probables | Mesures prises | Notifiée CNIL ? | Personnes informées ? | Justification si non |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

*(Registre à tenir dans un fichier séparé, non versionné dans ce dépôt public : il contient
des informations sur des incidents réels.)*

### 6. Corriger et vérifier

- Corriger la cause racine, pas seulement le symptôme.
- Ajouter un **test de régression** — c'est ce qui a été fait pour les constats C1 et C3 de
  l'audit, et ce qui empêche la faille de revenir silencieusement.
- Mettre à jour l'[audit](rgpd-audit-2026-08.md) et le
  [registre](rgpd-registre-traitements.md) si le traitement change.

---

## Contacts à avoir sous la main

| | |
|---|---|
| **Responsable de traitement** | Fergal Mechin — amimot-assistance@fergalmechin.fr |
| **CNIL — notification** | <https://notifications.cnil.fr> |
| **CNIL — standard** | 01 53 73 22 22 |
| **Hébergeur (OVHcloud)** | Support via l'espace client ; incident de sécurité : <https://www.ovhcloud.com/fr/abuse/> |
| **Google (si connexion Google compromise)** | Console Google Cloud → identifiants OAuth |

---

## Avant qu'il ne se passe quoi que ce soit

Trois choses à faire tant qu'il n'y a pas d'urgence, parce qu'elles sont impossibles à
improviser en 72 heures :

1. **Créer le compte sur <https://notifications.cnil.fr>** — la création prend du temps.
2. **Vérifier que les sauvegardes existent et sont restaurables.** Une sauvegarde jamais
   testée n'est pas une sauvegarde ; et sans elle, une perte de base devient une violation
   notifiable. Cf. [rgpd-conformite-operationnelle.md](rgpd-conformite-operationnelle.md).
3. **Se donner un moyen de contacter les utilisateurs.** C'est le maillon manquant : sans
   envoi d'email, l'article 34 ne peut être satisfait que par une communication publique,
   ce qui est un pis-aller.
