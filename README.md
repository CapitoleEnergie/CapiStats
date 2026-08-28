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

Exécuter dans l'ordre `db/001_stats_registry.sql` puis `db/002_odoo_import.sql`
sur le projet Supabase **Admin Portail** (déjà appliqués en production, les
27 et 28/08/2026).

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
CRON_SECRET=<chaîne aléatoire, protège la purge automatique>
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

## 8. Fichiers Import Odoo

L'application Import Odoo archive chaque fichier généré dans le bucket privé
`odoo-imports` (Supabase Storage), et le chemin est enregistré dans
`details.path` de la ligne `activity_logs`.

Le fichier ne transite jamais par une fonction Vercel : l'app Odoo demande une
URL d'upload signée au hub (`/api/log-odoo`, action `upload-url`), puis envoie
le fichier directement à Supabase. Le plafond est celui du bucket, 20 Mo.

**Téléchargement** — `POST /api/file { path }` renvoie une URL signée valable
60 secondes. L'accès est plus strict que celui des statistiques : seuls
**l'auteur du fichier et les administrateurs** peuvent le télécharger. Voir les
chiffres d'un collègue ne donne pas accès à ses fichiers. Chaque téléchargement
est journalisé (`Fichier Odoo téléchargé`).

**Conservation** — 90 jours. `api/cron-purge.js` tourne chaque nuit à 3 h
(cron déclaré dans `vercel.json`), supprime les fichiers échus par lots de 100
et marque la ligne `file_purged`. La statistique reste, l'interface affiche
« purgé » à la place du bouton.

Le branchement côté application Odoo est décrit dans `odoo-integration/`.

## 9. Interface

Refonte 28/08/2026, alignée sur la charte graphique Capitole 2026.

- **Couleurs** : jetons CSS repris de la charte — principale `#5020EA`, secondaire
  `#EDEDFF`, blanc bloc `#F3F3F3`, noir `#232323`, dégradé Capitole
  `#0C32FF → #E543DC → #FFC14F` (filet en tête de page, jauges, courbe).
- **Typographie** : Bricolage Grotesque bold pour les titres, Poppins pour le
  texte, chiffres en chasse tabulaire dans tous les tableaux.
- **Icônes** : Material Symbols Rounded, style rempli, graisse 400.
- **Composants** : rayon 10 px, boutons primaire/secondaire (contour 2 px)/
  tertiaire et bouton icône, conformes à la page « Éléments UI » de la charte.
- **Navigation** : barre latérale repliable (état mémorisé), qui passe en barre
  horizontale défilante sous 1020 px.
- **Graphique** : courbe d'évolution en SVG, sans librairie. Le pas s'adapte à
  la période (jour ≤ 45 j, semaine ≤ 180 j, mois au-delà) et les intervalles
  sans activité sont remplis à zéro. Infobulle au survol avec la ventilation
  par catégorie.
- **Accessibilité** : lien d'évitement, anneaux de focus visibles, cibles
  tactiles ≥ 44 px sur mobile, `aria-label` sur les boutons icône, résumé
  textuel du graphique pour les lecteurs d'écran, `prefers-reduced-motion`
  respecté, aucun débordement horizontal de 390 px à 1560 px.

### Le logo

Déposer le fichier **à la racine du projet**, à côté de `index.html` :

```
capitole-stats/
├── index.html
├── logo-capitole.svg      ← ici
├── favicon.svg            ← optionnel, même endroit
├── api/
└── db/
```

Pas de dossier `public/` : ce projet n'a pas de build, les fichiers statiques
sont servis depuis la racine. Le nom doit être exactement `logo-capitole.svg`.

`vercel.json` contient `{ "handle": "filesystem" }` avant la route attrape-tout.
Sans cette ligne, `/logo-capitole.svg` serait réécrit vers `index.html` et le
logo ne s'afficherait jamais.

Format : SVG de préférence (net à toutes les tailles), sinon PNG à 3× la taille
d'affichage, soit environ 100 px de haut. La version horizontale du logo
convient à l'en-tête ; le submark seul irait pour le favicon. S'il est absent,
l'en-tête bascule automatiquement sur le nom en typographie de marque.

## 10. Structure

```
index.html              UI complète (aucun build)
api/session.js          échange du token hub -> cookie de session
api/config.js           périmètre de l'utilisateur + matrice admin
api/stats.js            calcul d'une statistique
api/export.js           jeux de lignes pour l'export Excel
api/access.js           écriture de la matrice rôle x statistique (admin)
api/file.js             lien de téléchargement signé (auteur + admins)
api/cron-purge.js       purge quotidienne des fichiers de plus de 90 jours
api/_lib/engine.js      moteur d'agrégation config-driven
api/_lib/access.js      résolution des droits et du périmètre
api/_lib/session.js     cookie signé HMAC
api/_lib/supabase.js    client service_role
db/001_stats_registry.sql
db/002_odoo_import.sql  bucket + définition Import Odoo
test/engine.test.mjs    71 contrôles sur des lignes réelles (npm test)
```
