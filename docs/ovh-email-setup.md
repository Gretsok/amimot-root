# Mise en place de l'email OVH pour Amimot

**Objectif :** disposer d'une adresse `amimot-assistance@fergalmechin.fr` qui **reçoit** (voie
d'exercice des droits RGPD, obligatoire) et qui **envoie** (réinitialisation de mot de passe,
vérification d'email, information en cas de violation).

**Dernière mise à jour :** 2 août 2026

---

## État constaté le 2 août 2026

Relevé public de la zone `fergalmechin.fr` :

| Élément | Valeur observée | Verdict |
|---|---|---|
| Serveurs de noms | `ns200.anycast.me`, `dns200.anycast.me` | ✅ Zone hébergée chez OVH — tout se pilote depuis le panel |
| MX | `mx1.mail.ovh.net` (1), `mx2` (5), `mx3` (100) | ✅ Service email OVH **déjà actif** sur le domaine |
| SPF | `v=spf1 include:mx.ovh.com -all` | ✅ **Déjà correct** — ne pas y toucher |
| DKIM | Aucun sur les sélecteurs usuels (`ovh`, `mail`, `default`, `selector1`…) | ❓ Probablement absent — à confirmer dans le panel, OVH peut utiliser un sélecteur généré |
| DMARC (`_dmarc`) | Aucun | ❌ À créer |
| A `fergalmechin.fr` | `51.91.236.193` | — |
| A `amimot.fergalmechin.fr` | `46.105.28.219` | — (le VPS du jeu) |

**Conséquence :** le gros du travail est déjà fait. Il reste trois choses.

---

## ⚠️ La règle à ne pas enfreindre

**Il ne doit exister qu'UN SEUL enregistrement SPF** pour un domaine. Deux enregistrements
`v=spf1` rendent le SPF **invalide**, et tes emails se mettent à échouer — y compris ceux qui
partaient bien avant.

Ton SPF existe déjà et convient. Si un jour tu ajoutes un prestataire tiers (Brevo, Resend…),
il faudra **modifier** la ligne existante pour y insérer son `include:`, jamais en ajouter une
seconde.

Second point de vigilance : ton SPF finit par `-all` (*hard fail*), pas `~all` (*soft fail*).
C'est plus sûr, mais **moins pardonnant** : un expéditeur non déclaré voit ses mails
franchement rejetés, pas seulement marqués. À garder en tête le jour où tu ajoutes un
prestataire.

---

## Étape 1 — Créer la boîte `amimot-assistance@fergalmechin.fr`

Le service email est déjà actif : il s'agit d'ajouter un compte, pas d'activer une offre.

1. <https://www.ovh.com/manager/> → espace **Web Cloud**.
2. Section **E-mails** (selon l'offre : *MX Plan*, *Email Pro* ou *Hosted Exchange*) →
   sélectionner `fergalmechin.fr`.
3. Onglet **Comptes e-mail** → **Ajouter un compte**.
4. Adresse : `amimot-assistance`, mot de passe long et unique (il servira aussi
   d'identifiant SMTP à l'application — **le stocker dans un gestionnaire de mots de passe**,
   il finira dans une variable d'environnement du serveur).

> Si l'offre a épuisé son quota de comptes, deux options : réutiliser un alias vers une boîte
> existante (suffisant pour **recevoir**, mais **pas pour envoyer** — l'envoi SMTP exige un
> vrai compte), ou monter d'offre.

**Vérification :** envoyer un mail depuis une adresse externe vers
`amimot-assistance@fergalmechin.fr` et confirmer sa réception dans le webmail
(<https://www.ovhcloud.com/fr/mail/>).

Cette étape est requise **indépendamment de l'envoi** : c'est l'unique contact publié dans la
politique de confidentialité, et une adresse qui ne relève pas est un manquement à
l'article 12.

---

## Étape 2 — Activer DKIM

DKIM signe cryptographiquement les messages sortants. Sans lui, DMARC ne peut pas passer en
mode strict, et la délivrabilité reste médiocre.

1. Toujours dans **E-mails** → `fergalmechin.fr`, chercher l'option **DKIM** (onglet
   *Configuration*, ou colonne d'actions du domaine selon la version de l'interface).
2. L'activer. La zone DNS étant hébergée chez OVH, **l'enregistrement est publié
   automatiquement** — rien à recopier à la main.
3. Noter le **sélecteur** attribué (souvent de la forme `ovhXXXXXXXX`).

Si l'interface ne propose pas DKIM sur ton offre, c'est le seul point qui peut justifier de
passer à *Email Pro*, ou de basculer vers un prestataire transactionnel.

**Vérification** (remplacer `SELECTEUR`) :

```bash
nslookup -type=TXT SELECTEUR._domainkey.fergalmechin.fr 8.8.8.8
```

Une valeur commençant par `v=DKIM1; k=rsa; p=...` doit apparaître. Compter jusqu'à quelques
heures de propagation.

---

## Étape 3 — Publier DMARC

DMARC dit aux serveurs destinataires quoi faire quand SPF et DKIM échouent, et **te fait
remonter des rapports**. C'est le seul enregistrement à créer entièrement à la main.

1. Panel OVH → **Noms de domaine** → `fergalmechin.fr` → onglet **Zone DNS** → **Ajouter une
   entrée** → type **TXT**.
2. Sous-domaine : `_dmarc`
3. Valeur :

```
v=DMARC1; p=none; rua=mailto:amimot-assistance@fergalmechin.fr; fo=1; adkim=r; aspf=r
```

**Commencer impérativement par `p=none`.** Ce mode n'applique aucune sanction : il se contente
de t'envoyer des rapports. Démarrer directement en `p=reject` ferait disparaître, sans
avertissement, des emails légitimes que tu ne soupçonnes pas (facturation, formulaire de
contact du site, newsletter…).

**Durcissement, après 2 à 4 semaines de rapports propres :**

| Étape | `p=` | Effet |
|---|---|---|
| 1 (départ) | `none` | Observation seule |
| 2 | `quarantine` | Les échecs partent en indésirables |
| 3 (cible) | `reject` | Les échecs sont refusés |

**Vérification :**

```bash
nslookup -type=TXT _dmarc.fergalmechin.fr 8.8.8.8
```

---

## Étape 4 — Contrôler l'ensemble

1. **<https://www.mail-tester.com>** — la vérification la plus parlante : le site donne une
   adresse jetable, tu lui envoies un mail **depuis la boîte OVH** (via le webmail), et il
   note SPF, DKIM, DMARC, réputation et contenu. Viser 9/10 ou mieux.
2. **<https://mxtoolbox.com/SuperTool.aspx>** — vérifications ciblées, et surtout contrôle que
   l'IP d'envoi n'est sur aucune liste noire.

---

## Étape 5 — Tester l'envoi SMTP depuis le serveur

Avant de brancher l'application, confirmer que le VPS peut réellement émettre. Certains
hébergeurs bloquent le port 25 sortant ; **le port 587 doit rester ouvert** (c'est celui qu'on
utilisera).

Depuis le VPS :

```bash
docker run --rm -it node:22-alpine sh -c '
npm i -s nodemailer >/dev/null 2>&1
node -e "
const n=require(\"nodemailer\");
n.createTransport({
  host:\"ssl0.ovh.net\", port:587, secure:false,
  auth:{user:\"amimot-assistance@fergalmechin.fr\", pass:process.env.P}
}).sendMail({
  from:\"Amimot <amimot-assistance@fergalmechin.fr>\",
  to:process.env.T, subject:\"Test SMTP Amimot\", text:\"Ça marche.\"
}).then(r=>console.log(\"OK\", r.messageId)).catch(e=>console.error(\"ÉCHEC\", e.message));
"' 
```

en fournissant `P` (mot de passe de la boîte) et `T` (adresse de destination). Un `OK` suivi
d'un identifiant de message signifie que tout est en place.

---

## Paramètres SMTP OVH (pour la suite)

| Paramètre | Valeur |
|---|---|
| Serveur sortant | `ssl0.ovh.net` |
| Port | **587** (STARTTLS) — ou 465 (SSL/TLS) |
| Identifiant | l'adresse email **complète** |
| Mot de passe | celui de la boîte |
| Expéditeur (`From`) | `Amimot <amimot-assistance@fergalmechin.fr>` |

L'expéditeur doit rester sur `fergalmechin.fr` : c'est l'**alignement** entre le domaine du
`From` et celui qui porte SPF/DKIM que DMARC vérifie. Un `From` sur un autre domaine ferait
échouer DMARC malgré une configuration par ailleurs correcte.

Une fois l'étape 5 concluante, les variables à renseigner côté application seront :

```
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=587
SMTP_USER=amimot-assistance@fergalmechin.fr
SMTP_PASSWORD=…
MAIL_FROM=Amimot <amimot-assistance@fergalmechin.fr>
```

---

## Récapitulatif

- [ ] **Étape 1** — Boîte `amimot-assistance@` créée, réception vérifiée *(requis pour le RGPD,
      indépendamment de l'envoi)*
- [ ] **Étape 2** — DKIM activé, sélecteur noté, enregistrement visible dans le DNS
- [ ] **Étape 3** — DMARC publié en `p=none`
- [ ] **Étape 4** — mail-tester à 9/10 ou mieux
- [ ] **Étape 5** — envoi SMTP réussi depuis le VPS sur le port 587
- [ ] *(2 à 4 semaines plus tard)* — DMARC passé en `p=quarantine`, puis `p=reject`

Ne pas toucher au SPF : il est déjà correct.

---

## Pièges rencontrés couramment

| Piège | Conséquence | Parade |
|---|---|---|
| Ajouter un second enregistrement SPF | SPF invalide, **tous** les emails échouent | Modifier la ligne existante, ne jamais en créer une seconde |
| Démarrer DMARC en `p=reject` | Des mails légitimes disparaissent sans trace | Commencer par `p=none`, durcir ensuite |
| Conclure trop vite après une modification DNS | On croit à un échec alors que c'est de la propagation | Attendre, et interroger `8.8.8.8` plutôt que le résolveur local |
| Utiliser un alias au lieu d'un compte | La réception marche, l'envoi SMTP est refusé | Créer un vrai compte email |
| Port 25 bloqué en sortie par l'hébergeur | L'envoi échoue en production seulement | Utiliser le port 587, et le tester **depuis le VPS** |
| `From` sur un autre domaine que `fergalmechin.fr` | DMARC échoue malgré SPF/DKIM valides | Garder l'alignement du domaine expéditeur |
