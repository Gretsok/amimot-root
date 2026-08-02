# Conformité RGPD — actions hors code

**Dernière mise à jour :** 2 août 2026

Les correctifs applicatifs de l'[audit](rgpd-audit-2026-08.md) sont faits. Ce document
regroupe ce qui **ne peut pas être résolu depuis le dépôt** : cela dépend de contrats, de la
configuration du serveur de production, ou de vérifications que seul l'exploitant peut
faire.

Chaque point indique ce qui est **déjà fourni ici** et ce qui **reste à ta main**.

---

## 1. Accord de sous-traitance avec OVHcloud (art. 28)

**Pourquoi.** OVH héberge la base et le serveur : c'est un sous-traitant au sens du RGPD. Le
responsable de traitement doit disposer d'un contrat encadrant ce traitement, faute de quoi
il est en infraction indépendamment de tout incident.

**Bonne nouvelle** : OVHcloud publie un *Data Processing Agreement* intégré à ses conditions
générales. Il n'y a normalement rien à signer séparément — mais il faut **vérifier et
archiver**, pas supposer.

**À faire :**

- [ ] Récupérer le DPA OVHcloud en vigueur (Espace client → Contrats, ou
      <https://www.ovhcloud.com/fr/personal-data-protection/>) et l'archiver avec sa date
      de version.
- [ ] Vérifier que l'offre souscrite héberge bien en **France ou dans l'UE** (le registre
      l'affirme).
- [ ] Noter la référence dans le [registre](rgpd-registre-traitements.md), traitement n° 1.

**Google**, s'il reste un fournisseur d'identité, est également un destinataire à documenter :
vérifier le mécanisme de transfert hors UE qu'il invoque et l'archiver de même.

---

## 2. Sauvegardes de la base — le point le plus urgent

**Pourquoi c'est double.** Une sauvegarde manquante est un risque de **disponibilité** (une
perte de base sans restauration possible est une violation notifiable, art. 33) ; une
sauvegarde mal purgée est un risque de **conformité** (si la suppression d'un compte ne s'y
propage pas, le droit à l'effacement n'est pas effectif).

**État actuel : inconnu.** Le dépôt ne contient aucun mécanisme de sauvegarde. Le volume
`pgdata` est persistant, ce qui protège d'un redémarrage de conteneur — **pas** d'une perte
de disque, d'une suppression accidentelle ni d'une corruption.

**À faire :**

- [ ] Déterminer si l'offre OVH inclut des instantanés (*snapshots*) et à quelle fréquence.
- [ ] Si non, mettre en place un `pg_dump` périodique (script fourni ci-dessous).
- [ ] **Tester une restauration.** Une sauvegarde jamais restaurée n'est pas une sauvegarde.
- [ ] Fixer une rétention (30 jours est un choix courant et raisonnable) et **la déclarer**
      dans le registre et la politique de confidentialité.
- [ ] Décider comment la suppression d'un compte se propage aux sauvegardes. La réponse
      admise, si la purge rétroactive est impossible, est de conserver une rétention
      **courte et bornée**, et de le dire aux personnes.

Un script de départ, à adapter et à installer **sur le serveur** (il n'est volontairement
pas branché dans le dépôt : un mécanisme de sauvegarde non testé qui prétend exister est pire
que rien) :

```bash
#!/bin/sh
# /usr/local/bin/amimot-backup.sh — à lancer par cron, ex. : 0 3 * * *
set -eu
DEST=/var/backups/amimot
RETENTION_DAYS=30
mkdir -p "$DEST"
docker exec amimot-postgres-1 pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$DEST/amimot-$(date +%F).sql.gz"
# La purge fait partie de la sauvegarde, pas d'une tâche séparée qu'on oublie.
find "$DEST" -name 'amimot-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
```

Les sauvegardes contiennent des données personnelles : les stocker sur un support à accès
restreint, et chiffré si elles quittent le serveur.

---

## 3. Journaux du reverse proxy de l'hôte

**Pourquoi.** Les journaux d'accès contiennent des **adresses IP**, qui sont des données
personnelles. Sans rotation, ils les conservent indéfiniment — ce qui contredit la politique
de confidentialité.

**Déjà fait :** les journaux des trois conteneurs Docker sont plafonnés à 3 fichiers de
10 Mo par service (`docker-compose.yml`), soit une fenêtre glissante récente.

**Reste à faire :** le nginx **de l'hôte** (celui qui termine le TLS devant le conteneur
Caddy, cf. l'architecture de production) n'est pas géré par ce dépôt.

- [ ] Vérifier que `logrotate` traite bien les journaux de ce nginx (c'est le cas par défaut
      sur la plupart des distributions, avec une rétention de 14 jours).
- [ ] Ajuster la rétention si besoin, et **reporter la valeur réelle** dans le
      [registre](rgpd-registre-traitements.md), traitement n° 3.
- [ ] Envisager d'anonymiser les IP dans les journaux d'accès si le diagnostic ne les exige
      pas — c'est la mesure la plus protectrice, cf. exemple ci-dessous.

Une configuration de rotation prête à installer est fournie :
[`deploy/logrotate-amimot-nginx.conf`](../deploy/logrotate-amimot-nginx.conf).

Pour tronquer les IPv4 au dernier octet (`203.0.113.42` → `203.0.113.0`), ajouter dans le
`http { }` de nginx :

```nginx
map $remote_addr $ip_anonyme {
    ~(?<prefixe>\d+\.\d+\.\d+)\.    "$prefixe.0";
    ~(?<prefixe>[^:]+:[^:]+):       "$prefixe::";
    default                          "0.0.0.0";
}
log_format anonyme '$ip_anonyme - $remote_user [$time_local] "$request" '
                   '$status $body_bytes_sent "$http_referer" "$http_user_agent"';
access_log /var/log/nginx/amimot-access.log anonyme;
```

À ne faire que si tu n'as pas besoin des IP complètes pour bloquer des abus.

---

## 4. Chiffrement au repos

- [ ] Déterminer si le volume `pgdata` repose sur un stockage chiffré (dépend de l'offre
      OVH et de la configuration du VPS).
- [ ] Reporter la réponse dans le [registre](rgpd-registre-traitements.md), section
      « Mesures de sécurité ».

Ce n'est pas une obligation absolue : l'article 32 demande des mesures **adaptées au
risque**. Pour des emails et des empreintes bcrypt, l'absence de chiffrement au repos est
défendable si l'accès au serveur est correctement restreint. Il faut simplement pouvoir le
justifier.

---

## 5. Adresse du responsable de traitement

Le registre laisse `[À COMPLÉTER]` sur l'adresse. Elle n'a pas à être publiée sur le site
(arbitrage assumé, cf. [audit §G2](rgpd-audit-2026-08.md#g2)), **mais elle doit figurer dans
le registre**, qui est un document interne présenté à la CNIL sur demande.

- [ ] Compléter l'adresse dans [rgpd-registre-traitements.md](rgpd-registre-traitements.md).

---

## 6. Avant toute mise en ligne publique

- [ ] Créer le compte sur <https://notifications.cnil.fr> — cf.
      [procédure de violation](rgpd-procedure-violation.md). À faire **avant** d'en avoir
      besoin.
- [ ] Vérifier que `amimot-assistance@fergalmechin.fr` reçoit réellement du courrier : c'est
      l'unique voie d'exercice des droits publiée. Une adresse qui ne relève pas est un
      manquement à l'article 12.
- [ ] Relire la [politique de confidentialité](../frontend/src/screens/Legal/PrivacyPolicy.jsx)
      et vérifier qu'elle correspond toujours au code.

---

## Récapitulatif

| # | Action | Qui | Urgence |
|---|---|---|---|
| 2 | Sauvegardes : existence, test de restauration, rétention | Toi | **Élevée** |
| 6 | Adresse de contact réellement relevée | Toi | **Élevée** |
| 1 | Archiver le DPA OVHcloud | Toi | Moyenne |
| 3 | Rétention des journaux nginx de l'hôte | Toi | Moyenne |
| 6 | Compte CNIL de notification | Toi | Moyenne |
| 5 | Adresse dans le registre | Toi | Moyenne |
| 4 | Chiffrement au repos : constater et documenter | Toi | Faible |
