-- ============================================================
--  Import Odoo — stockage des fichiers générés + définition stats
--  Appliqué en production le 28/08/2026
-- ============================================================

-- ── Bucket privé (20 Mo par fichier) ────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('odoo-imports', 'odoo-imports', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Aucune policy sur storage.objects : seules les API (service_role) y
-- accèdent, et toujours via des URL signées à durée courte.

-- ── Définition ──────────────────────────────────────────────
insert into public.stats_definitions (key, app_slug, label, description, icon, sort_order, match, config)
values (
  'odoo_import', 'odoo',
  'Import Odoo', 'Transformations Salesforce → Odoo : volumétrie, erreurs et téléchargement des fichiers générés', 'upload_file', 45,
  $m${"mode":"prefix","values":["Import Odoo"]}$m$::jsonb,
  $c${
    "categories":[
      {"key":"succes","label":"Réussi","color":"green","match":{"mode":"equals","values":["Import Odoo généré"]}},
      {"key":"erreur","label":"En erreur","color":"orange","match":{"mode":"equals","values":["Import Odoo en erreur"]}}
    ],
    "kpis":[
      {"label":"Transformations","type":"count"},
      {"label":"Réussies","type":"count_category","category":"succes","color":"green"},
      {"label":"En erreur","type":"count_category","category":"erreur","color":"orange"},
      {"label":"Taux d'erreur","type":"rate","num":"erreur","den":"__total","color":"orange"},
      {"label":"Lignes générées","type":"sum","field":"details.rows_out"},
      {"label":"Moy. lignes / fichier","type":"avg","field":"details.rows_out","decimals":0},
      {"label":"Utilisateurs actifs","type":"distinct","field":"email"}
    ],
    "breakdowns":[
      {"key":"by_user","label":"Transformations par utilisateur","header":"Utilisateur","field":"email",
       "columns":["count","share","categories","rate:erreur:__total","sum:details.rows_out","last"]},
      {"key":"by_error","label":"Erreurs les plus fréquentes","header":"Erreur","field":"details.error",
       "limit":15,"columns":["count","distinct:email","last"]}
    ],
    "detail":{
      "columns":[
        {"label":"Date","field":"created_at","type":"datetime"},
        {"label":"Statut","field":"__category","type":"category"},
        {"label":"Utilisateur","field":"email"},
        {"label":"Fichier généré","field":"details.filename","type":"file","path_field":"details.path","size_field":"details.size"},
        {"label":"Fichier source","field":"details.client"},
        {"label":"Lignes","field":"details.rows_out"},
        {"label":"Colonnes","field":"details.cols"},
        {"label":"Durée","field":"details.duration_ms"},
        {"label":"Erreur","field":"details.error","type":"note"}
      ],
      "search":["email","details.filename","details.client","details.error"]
    }
  }$c$::jsonb
)
on conflict (key) do update set
  app_slug=excluded.app_slug, label=excluded.label, description=excluded.description,
  icon=excluded.icon, sort_order=excluded.sort_order, match=excluded.match,
  config=excluded.config, updated_at=now();

-- ── Accès : Direction, Resp Commercial, Resp ADV ────────────
insert into public.stats_role_access (role_key, definition_key, scope) values
  ('direction','odoo_import','all'),
  ('resp_commercial','odoo_import','all'),
  ('resp_adv','odoo_import','all')
on conflict (role_key, definition_key) do update set scope = excluded.scope;
