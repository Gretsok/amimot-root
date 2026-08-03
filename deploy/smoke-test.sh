#!/usr/bin/env bash
# Vérification post-déploiement d'Amimot — à lancer SUR LE VPS, depuis la
# racine du dépôt, après `docker compose ... up -d --build`.
#
#   bash deploy/smoke-test.sh
#   bash deploy/smoke-test.sh amimot.fergalmechin.fr
#
# Ne modifie rien de durable : le compte de test créé est supprimé à la fin,
# y compris si un contrôle échoue en cours de route.
#
# Complète — sans remplacer — les suites automatisées (Jest, Vitest,
# Playwright) : celles-ci valident le code, celui-ci valide le déploiement.

set -uo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
LOCAL_URL="http://127.0.0.1:8081"   # Caddy, publié seulement sur la boucle locale
COOKIES="$(mktemp)"
FAILURES=0
CHECKS=0
CLEANUP_EMAIL=""
CLEANUP_PASSWORD=""

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'

ok()   { CHECKS=$((CHECKS+1)); printf '  %s[ OK ]%s %s\n' "$GREEN" "$OFF" "$1"; }
fail() { CHECKS=$((CHECKS+1)); FAILURES=$((FAILURES+1)); printf '  %s[ÉCHEC]%s %s\n' "$RED" "$OFF" "$1"; [ $# -gt 1 ] && printf '         %s%s%s\n' "$DIM" "$2" "$OFF"; }
warn() { printf '  %s[ ?  ]%s %s\n' "$YELLOW" "$OFF" "$1"; }
section() { printf '\n%s\n' "$1"; }

check() { # check "libellé" "condition déjà évaluée (0/1)" "détail"
  if [ "$2" -eq 0 ]; then ok "$1"; else fail "$1" "${3:-}"; fi
}

# Supprime le compte de test quoi qu'il arrive (échec, Ctrl-C).
cleanup() {
  if [ -n "$CLEANUP_EMAIL" ]; then
    curl -s -c "$COOKIES" -b "$COOKIES" -X POST "$LOCAL_URL/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"$CLEANUP_EMAIL\",\"password\":\"$CLEANUP_PASSWORD\"}" >/dev/null 2>&1
    curl -s -b "$COOKIES" -X DELETE "$LOCAL_URL/api/account/me" >/dev/null 2>&1
  fi
  rm -f "$COOKIES"
}
trap cleanup EXIT INT TERM

printf '%s\n' "Vérification post-déploiement — Amimot"
[ -n "$DOMAIN" ] && printf 'Domaine public : %s\n' "$DOMAIN" \
                 || printf '%sDomaine public non fourni : les contrôles HTTPS seront ignorés.%s\n' "$YELLOW" "$OFF"

# --------------------------------------------------------------------------
section "1. Conteneurs"

for service in postgres backend frontend; do
  state=$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$service" '$1==s {print $2}')
  if [ "$state" = "running" ]; then ok "conteneur $service en cours d'exécution"
  else fail "conteneur $service" "état = ${state:-absent}"; fi
done

# Redémarrages en boucle : un conteneur qui plante et repart paraît "running"
# à l'instant T. Un compteur non nul est le signe qui le trahit.
restarts=$(docker inspect --format '{{.RestartCount}}' amimot-backend-1 2>/dev/null || echo "?")
if [ "$restarts" = "0" ]; then ok "backend n'a jamais redémarré"
elif [ "$restarts" = "?" ]; then warn "compteur de redémarrages du backend illisible"
else fail "backend a redémarré $restarts fois" "docker compose logs backend"; fi

# --------------------------------------------------------------------------
section "2. Backend et migrations"

# /healthz n'est PAS exposé publiquement : le Caddyfile ne proxifie que /api/*
# et /socket.io/*, tout le reste retombe sur l'index du SPA. On interroge donc
# le backend depuis l'intérieur du réseau Docker.
health=$(docker compose exec -T backend wget -qO- http://localhost:3000/healthz 2>/dev/null)
case "$health" in
  *'"ok"'*) ok "backend répond sur /healthz" ;;
  *)        fail "backend ne répond pas sur /healthz" "réponse : ${health:-vide}" ;;
esac

# Les migrations sont appliquées au démarrage (CMD du Dockerfile). Si l'une
# manque, la base et le code sont désynchronisés.
migrations=$(docker compose exec -T backend npx prisma migrate status 2>&1)
case "$migrations" in
  *"up to date"*|*"à jour"*) ok "migrations de base appliquées" ;;
  *) fail "migrations en retard ou en échec" "$(printf '%s' "$migrations" | tail -3 | tr '\n' ' ')" ;;
esac

defaults=$(curl -s -o /dev/null -w '%{http_code}' "$LOCAL_URL/api/config/game-defaults")
check "l'API répond à travers le proxy ($LOCAL_URL/api)" "$([ "$defaults" = "200" ] && echo 0 || echo 1)" "HTTP $defaults"

# --------------------------------------------------------------------------
section "3. Service des pages"

# Repli SPA : sans lui, un lien direct vers une page légale renvoie 404 — or
# l'art. 12 du RGPD demande une information « aisément accessible ». Ce
# contrôle passe par Caddy en local, donc il vaut MÊME SANS domaine : c'est le
# point le plus fragile de la configuration, il ne doit jamais être sauté.
ROUTES="confidentialite mentions-legales compte mot-de-passe-oublie reinitialiser confirmer-email"

code=$(curl -s -o /dev/null -w '%{http_code}' "$LOCAL_URL/")
check "l'accueil est servi" "$([ "$code" = "200" ] && echo 0 || echo 1)" "HTTP $code"

for route in $ROUTES; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$LOCAL_URL/$route")
  check "/$route servi par le repli SPA" "$([ "$code" = "200" ] && echo 0 || echo 1)" "HTTP $code"
done

section "3 bis. Exposition publique"

if [ -n "$DOMAIN" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
  check "l'accueil répond en HTTPS" "$([ "$code" = "200" ] && echo 0 || echo 1)" "HTTP $code"

  headers=$(curl -sI "https://$DOMAIN/")
  case "$headers" in
    *[Ss]trict-[Tt]ransport-[Ss]ecurity*) ok "en-tête HSTS présent" ;;
    *) fail "en-tête HSTS absent" "attendu sur les réponses statiques (Caddyfile.prod)" ;;
  esac

  # Une route cliente en HTTPS : confirme que le proxy de l'hôte relaie bien le
  # repli vérifié plus haut, et ne se contente pas de servir la racine.
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/confidentialite")
  check "/confidentialite joignable publiquement" "$([ "$code" = "200" ] && echo 0 || echo 1)" "HTTP $code"

  redirect=$(curl -s -o /dev/null -w '%{http_code}' "http://$DOMAIN/")
  case "$redirect" in
    30*) ok "HTTP redirige vers HTTPS (HTTP $redirect)" ;;
    *)   warn "http://$DOMAIN répond $redirect — vérifier la redirection côté nginx" ;;
  esac
else
  warn "contrôles HTTPS ignorés (aucun domaine fourni) — le repli SPA a tout de même été vérifié en local"
fi

# --------------------------------------------------------------------------
section "4. Parcours de compte"

STAMP="$(date +%s)$RANDOM"
EMAIL="smoke-$STAMP@example.invalid"   # .invalid : jamais routable, aucun mail réel
PASSWORD="verification deploiement 42"
PSEUDO="SMOKE$(printf '%s' "$STAMP" | tail -c 10)"
CLEANUP_EMAIL="$EMAIL"; CLEANUP_PASSWORD="$PASSWORD"

api() { # api MÉTHODE CHEMIN [CORPS_JSON] -> "corps<TAB>code"
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -c "$COOKIES" -b "$COOKIES" -X "$method" "$LOCAL_URL$path" \
      -H 'Content-Type: application/json' -d "$body" -w '\t%{http_code}'
  else
    curl -s -c "$COOKIES" -b "$COOKIES" -X "$method" "$LOCAL_URL$path" -w '\t%{http_code}'
  fi
}
status() { printf '%s' "$1" | awk -F'\t' '{print $NF}'; }
body()   { printf '%s' "$1" | awk -F'\t' '{NF--; print}' OFS='\t'; }

res=$(api POST /api/auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"pseudo\":\"$PSEUDO\",\"acceptedPolicy\":true}")
check "inscription" "$([ "$(status "$res")" = "201" ] && echo 0 || echo 1)" "HTTP $(status "$res") — $(body "$res")"

res=$(api POST /api/auth/register "{\"email\":\"weak-$STAMP@example.invalid\",\"password\":\"court\",\"pseudo\":\"W$STAMP\",\"acceptedPolicy\":true}")
check "mot de passe trop court refusé" "$([ "$(status "$res")" = "422" ] && echo 0 || echo 1)" "HTTP $(status "$res")"

res=$(api POST /api/auth/register "{\"email\":\"nc-$STAMP@example.invalid\",\"password\":\"$PASSWORD\",\"pseudo\":\"N$STAMP\",\"acceptedPolicy\":false}")
check "inscription sans acceptation refusée" "$([ "$(status "$res")" = "422" ] && echo 0 || echo 1)" "HTTP $(status "$res")"

res=$(api GET /api/account/me)
check "profil accessible une fois connecté" "$([ "$(status "$res")" = "200" ] && echo 0 || echo 1)" "HTTP $(status "$res")"

res=$(api GET /api/account/me/export)
export_body=$(body "$res")
check "export des données (art. 20)" "$([ "$(status "$res")" = "200" ] && echo 0 || echo 1)" "HTTP $(status "$res")"
case "$export_body" in
  *passwordHash*) fail "l'export contient une empreinte de mot de passe" ;;
  *) ok "l'export ne contient aucune empreinte de mot de passe" ;;
esac
case "$export_body" in
  *_informations*) ok "l'export mentionne ce qu'il ne contient pas" ;;
  *) fail "l'export ne porte pas la note d'information" ;;
esac

# --------------------------------------------------------------------------
section "5. Révocation de session"

# Effacer le cookie ne suffisait pas historiquement : le jeton restait valable.
# On rejoue donc le cookie APRÈS déconnexion, il doit être refusé.
saved_cookie=$(mktemp); cp "$COOKIES" "$saved_cookie"
api POST /api/auth/logout >/dev/null
replay=$(curl -s -o /dev/null -w '%{http_code}' -b "$saved_cookie" "$LOCAL_URL/api/account/me")
rm -f "$saved_cookie"
check "un jeton rejoué après déconnexion est refusé" "$([ "$replay" = "401" ] && echo 0 || echo 1)" "HTTP $replay (401 attendu)"

res=$(api POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
check "reconnexion" "$([ "$(status "$res")" = "200" ] && echo 0 || echo 1)" "HTTP $(status "$res")"

# --------------------------------------------------------------------------
section "5 bis. Changement de mot de passe"

NEW_PASSWORD="verification deploiement 43"

# Sans le mot de passe actuel, un poste laissé ouvert suffirait à verrouiller
# le compte de son propriétaire.
res=$(api POST /api/auth/change-password "{\"currentPassword\":\"pas le bon\",\"newPassword\":\"$NEW_PASSWORD\"}")
check "changement refusé sans le mot de passe actuel" "$([ "$(status "$res")" = "401" ] && echo 0 || echo 1)" "HTTP $(status "$res") (401 attendu)"

res=$(api POST /api/auth/change-password "{\"currentPassword\":\"$PASSWORD\",\"newPassword\":\"court\"}")
check "politique de mot de passe appliquée au changement" "$([ "$(status "$res")" = "422" ] && echo 0 || echo 1)" "HTTP $(status "$res") (422 attendu)"

# Le cookie de l'appelant est réémis : le déconnecter au moment où il sécurise
# son compte serait gratuit.
saved_cookie=$(mktemp); cp "$COOKIES" "$saved_cookie"
res=$(api POST /api/auth/change-password "{\"currentPassword\":\"$PASSWORD\",\"newPassword\":\"$NEW_PASSWORD\"}")
if [ "$(status "$res")" = "200" ]; then PASSWORD="$NEW_PASSWORD"; CLEANUP_PASSWORD="$NEW_PASSWORD"; fi
check "changement de mot de passe" "$([ "$(status "$res")" = "200" ] && echo 0 || echo 1)" "HTTP $(status "$res")"

still=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIES" "$LOCAL_URL/api/account/me")
check "la session appelante reste valable" "$([ "$still" = "200" ] && echo 0 || echo 1)" "HTTP $still (200 attendu)"

# Changer son mot de passe parce qu'on se croit compromis ne sert à rien si
# l'intrus reste connecté.
other=$(curl -s -o /dev/null -w '%{http_code}' -b "$saved_cookie" "$LOCAL_URL/api/account/me")
rm -f "$saved_cookie"
check "les autres sessions sont révoquées" "$([ "$other" = "401" ] && echo 0 || echo 1)" "HTTP $other (401 attendu)"

# --------------------------------------------------------------------------
section "5 ter. Confirmation d'adresse"

res=$(api GET /api/account/me)
case "$(body "$res")" in
  *emailVerifiedAt*) ok "le statut de confirmation est exposé au client" ;;
  *) fail "le profil ne porte pas emailVerifiedAt" "l'espace compte ne pourra pas signaler une adresse non confirmée" ;;
esac

# On ne déclenche PAS de renvoi réel : l'adresse de test est en `.invalid`,
# un envoi vers elle échouerait pour de bonnes raisons et rendrait ce contrôle
# ininterprétable. On vérifie seulement que le point d'entrée est branché et
# protégé — le renvoi lui-même est couvert par les tests d'intégration.
anon=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$LOCAL_URL/api/auth/resend-verification")
check "renvoi de confirmation refusé sans session" "$([ "$anon" = "401" ] && echo 0 || echo 1)" "HTTP $anon (401 attendu)"

res=$(api POST /api/auth/verify-email '{"token":"jeton-invente"}')
check "jeton de confirmation forgé refusé" "$([ "$(status "$res")" = "400" ] && echo 0 || echo 1)" "HTTP $(status "$res") (400 attendu)"

# --------------------------------------------------------------------------
section "6. Envoi d'email"

smtp_host=$(docker compose exec -T backend printenv SMTP_HOST 2>/dev/null | tr -d '\r')
if [ -z "$smtp_host" ]; then
  fail "SMTP non configuré — la réinitialisation de mot de passe n'enverra rien" \
       "renseigner SMTP_HOST/SMTP_USER/SMTP_PASSWORD/MAIL_FROM/APP_URL dans .env, puis redémarrer"
else
  ok "SMTP configuré (hôte : $smtp_host)"

  since=$(date --utc +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S)
  res=$(api POST /api/auth/forgot-password "{\"email\":\"$EMAIL\"}")
  check "demande de réinitialisation acceptée" "$([ "$(status "$res")" = "204" ] && echo 0 || echo 1)" "HTTP $(status "$res")"

  # Adresse inconnue : la réponse doit être RIGOUREUSEMENT identique, sinon ce
  # point d'entrée révèle quelles adresses ont un compte.
  res2=$(api POST /api/auth/forgot-password "{\"email\":\"personne-$STAMP@example.invalid\"}")
  check "réponse identique pour une adresse inconnue" \
        "$([ "$(status "$res")" = "$(status "$res2")" ] && echo 0 || echo 1)" \
        "connue : $(status "$res") / inconnue : $(status "$res2")"

  sleep 3
  logs=$(docker compose logs --since "$since" backend 2>/dev/null)
  case "$logs" in
    *"SMTP non configuré"*) fail "le mailer est resté inerte malgré SMTP_HOST" "le conteneur a-t-il été redémarré après le .env ?" ;;
    *)                      ok "aucune trace de mailer inerte dans les journaux" ;;
  esac
  case "$logs" in
    *"échec de la demande"*) fail "l'envoi a échoué côté serveur" "docker compose logs backend" ;;
    *)                       ok "aucune erreur d'envoi journalisée" ;;
  esac
fi

# --------------------------------------------------------------------------
section "7. Rétention des journaux (RGPD)"

for c in amimot-postgres-1 amimot-backend-1 amimot-frontend-1; do
  max=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$c" 2>/dev/null)
  check "rotation des journaux active sur $c" "$([ -n "$max" ] && echo 0 || echo 1)" \
        "aucune limite : les adresses IP y sont conservées sans fin"
done

# --------------------------------------------------------------------------
section "8. Suppression du compte de test (art. 17)"

res=$(api DELETE /api/account/me)
check "suppression du compte" "$([ "$(status "$res")" = "204" ] && echo 0 || echo 1)" "HTTP $(status "$res")"
after=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIES" "$LOCAL_URL/api/account/me")
check "le compte supprimé n'est plus accessible" "$([ "$after" = "401" ] && echo 0 || echo 1)" "HTTP $after"
CLEANUP_EMAIL=""   # déjà supprimé, ne pas retenter dans le trap

# --------------------------------------------------------------------------
printf '\n%s\n' "─────────────────────────────────────────────"
if [ "$FAILURES" -eq 0 ]; then
  printf '%sTout est vert — %d contrôles.%s\n' "$GREEN" "$CHECKS" "$OFF"
else
  printf '%s%d échec(s) sur %d contrôles.%s\n' "$RED" "$FAILURES" "$CHECKS" "$OFF"
fi
printf 'Les contrôles qui demandent un navigateur restent à faire à la main :\n'
printf '  cf. docs/verification-post-deploiement.md, section « Contrôles manuels ».\n'
exit "$FAILURES"
