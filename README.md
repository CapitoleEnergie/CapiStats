# Capitole — Application Statistiques

Application dédiée aux statistiques du hub Capitole. Elle remplace l'onglet
« Statistiques » de `Capitole_Admin`.

Principe : chaque application du hub écrit des lignes dans `activity_logs`
(comme aujourd'hui). L'app Statistiques ne contient **aucune** logique métier
codée en dur : elle lit le registre `stats_definitions` en base et construit
KPI, tableaux et export à partir de cette configuration.

Ajouter une application aux statistiques = insérer une ligne dans
`stats_definitions`. Aucun déploiement nécessaire.

---

## 1. Base de données

Exécuter `db/001_stats_registry.sql` sur le projet Supabase **Admin Portail**
(déjà appliqué en production le 27/08/2026).

Tables créées :

| Table | Rôle |
|---|---|
| `stats_roles` | Catalogue des rôles : Direction, Resp Commercial, Resp ADV, Resp Partenaire, Resp Pricing |
| `stats_definitions` | Une ligne = un bloc de statistiques (filtre sur `action` + configuration JSON) |
| `stats_role_access` | Quel rôle voit quelle statistique, et sur quel périmètre |
| `profiles.stats_role` | Rôle stats du collaborateur (nouvelle colonne, `cellule` inchangée) |

RLS activée sans policy sur les trois nouvelles tables : elles ne sont
accessibles qu'avec la `service_role`, donc uniquement par les API.

## 2. Déploiement Vercel

Nouveau projet Vercel pointant sur ce dossier. Variables d'environnement :

```
SUPABASE_URL=https://tnrzslycmnldllcofreb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key du projet Admin Portail>
HUB_URL=https://<domaine-du-hub>
SESSION_SECRET=<chaîne aléatoire de 32+ caractères>
```

Générer le secret : `openssl rand -base64 48`

Puis mettre l'URL réelle dans le hub :

```sql
update applications set url = 'https://<url-vercel-de-cette-app>' where slug = 'stats';
```

Côté hub, ajouter cette URL à `ALLOWED_APP_ORIGINS` n'est **pas** nécessaire :
la vérification du token se fait de serveur à serveur.

## 3. Authentification

1. L'utilisateur clique sur « Statistiques » dans le hub.
2. Le hub génère un token à usage unique (30 s) et redirige vers `?token=…`.
3. `POST /api/session` consomme le token auprès de `HUB_URL/api/verify-app-token`,
   relit le profil en base, puis pose un cookie de session signé (HMAC, 8 h,
   HttpOnly + Secure + SameSite=Lax).
4. Chaque appel API revalide le profil en base : retirer un rôle prend effet
   immédiatement, sans attendre l'expiration du cookie.

Accès refusé si l'utilisateur n'est ni `role = 'admin'` ni porteur d'un
`stats_role`.

## 4. Périmètres

`stats_role_access.scope` :

- `all` — toutes les lignes
- `cellule` — uniquement les emails de la cellule de l'utilisateur
- `self` — uniquement ses propres lignes

Le filtre est appliqué **côté serveur** : un utilisateur ne peut pas
élargir son périmètre en manipulant la requête.

## 5. Le format d'une définition

```jsonc
{
  "key": "box_prix",
  "app_slug": "box-prix",
  "label": "Box des prix",
  "match": { "mode": "in", "values": ["Box prix consultée", "Box prix exportée"] },
  "config": {
    // découpage en types d'événements
    "categories": [
      { "key": "export", "label": "Export PDF", "color": "green",
        "match": { "mode": "equals", "values": ["Box prix exportée"] } }
    ],
    // compteurs du haut
    "kpis": [
      { "label": "Consultations", "type": "count_category", "category": "consult" },
      { "label": "Taux", "type": "rate", "num": "export", "den": "consult" }
    ],
    // tableaux d'agrégation
    "breakdowns": [
      { "key": "by_user", "label": "Par Sales", "header": "Utilisateur", "field": "email",
        "columns": ["count", "share", "categories", "rate:export:consult", "distinct:details.compte", "last"] }
    ],
    // tableau de détail + export Excel
    "detail": {
      "columns": [{ "label": "Date", "field": "created_at", "type": "datetime" }],
      "search": ["details.compte", "email"]
    }
  }
}
```

`match.mode` : `prefix` | `in` | `equals`

Champs : `email`, `action`, `created_at`, `details.<clé>`, `__category`.
Options par champ : `extract` (regex de capture), `transform` (`upper`/`lower`/`trim`),
`fallback`, `multi` (éclate un tableau JSON en autant de lignes).

Types de KPI : `count`, `count_category`, `distinct`, `distinct_multi`,
`rate`, `avg_per`, `sum`, `avg`.

Colonnes de breakdown : `count`, `share`, `last`, `categories`,
`rate:<num>:<den>`, `distinct:<champ>`, `sum:<champ>`, `chips:<champ>`.

Types de colonne de détail : `datetime`, `chip`, `category`, `list`, `ref`, `note`.

## 6. Ajouter une application

```sql
insert into stats_definitions (key, app_slug, label, description, icon, sort_order, match, config)
values ('mon_app', 'mon-slug', 'Mon application', 'Ce que ça mesure', 'insights', 60,
  '{"mode":"prefix","values":["Mon action"]}'::jsonb,
  '{"kpis":[{"label":"Événements","type":"count"}],
    "breakdowns":[{"key":"by_user","label":"Par utilisateur","header":"Utilisateur","field":"email",
                   "columns":["count","share","last"]}],
    "detail":{"columns":[{"label":"Date","field":"created_at","type":"datetime"},
                         {"label":"Utilisateur","field":"email"}],
              "search":["email"]}}'::jsonb);
```

Puis ouvrir l'accès aux rôles concernés depuis l'app (panneau
« Accès par rôle », visible des admins) ou en SQL dans `stats_role_access`.

## 7. Différences avec l'ancien onglet

- Agrégation **serveur** avec pagination complète : plus de plafond silencieux
  à 500 / 1000 lignes (garde-fou à 50 000 avec avertissement affiché).
- Les contrats **GDB** et les **retours de gain** sont désormais comptés
  (l'ancien filtre `ilike 'Contrat généré%'` les ignorait).
- Nouveau bloc transverse « Accès aux applications ».
- Le navigateur ne reçoit plus la clé Supabase ni les logs bruts hors périmètre.
- Périodes étendues (12 mois) et détail paginé côté client.

## 8. Structure

```
index.html              UI complète (aucun build)
api/session.js          échange du token hub -> cookie de session
api/config.js           périmètre de l'utilisateur + matrice admin
api/stats.js            calcul d'une statistique
api/export.js           jeux de lignes pour l'export Excel
api/access.js           écriture de la matrice rôle x statistique (admin)
api/_lib/engine.js      moteur d'agrégation config-driven
api/_lib/access.js      résolution des droits et du périmètre
api/_lib/session.js     cookie signé HMAC
api/_lib/supabase.js    client service_role
db/001_stats_registry.sql
```
