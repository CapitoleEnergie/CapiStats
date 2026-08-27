-- ============================================================
--  Capitole — Registre des statistiques (config-driven)
--  Projet Supabase : Admin Portail (tnrzslycmnldllcofreb)
--  Additif uniquement : aucune table ni colonne existante n'est modifiée
-- ============================================================

-- ── 1. Catalogue des rôles stats ────────────────────────────
create table if not exists public.stats_roles (
  key         text primary key,
  label       text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true
);

-- ── 2. Définitions : une ligne = un bloc de statistiques ────
create table if not exists public.stats_definitions (
  key         text primary key,
  app_slug    text,
  label       text not null,
  description text,
  icon        text not null default 'query_stats',
  sort_order  int  not null default 0,
  active      boolean not null default true,
  match       jsonb not null,                        -- {"mode":"prefix|in|equals","values":[...]}
  config      jsonb not null default '{}'::jsonb,    -- kpis / categories / breakdowns / detail
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── 3. Qui voit quoi ────────────────────────────────────────
create table if not exists public.stats_role_access (
  role_key       text not null references public.stats_roles(key)       on delete cascade,
  definition_key text not null references public.stats_definitions(key) on delete cascade,
  scope          text not null default 'all' check (scope in ('all','cellule','self')),
  primary key (role_key, definition_key)
);

-- ── 4. Rôle stats porté par le profil ───────────────────────
alter table public.profiles
  add column if not exists stats_role text references public.stats_roles(key);

-- ── 5. RLS : tout passe par les API (service_role) ──────────
alter table public.stats_roles       enable row level security;
alter table public.stats_definitions enable row level security;
alter table public.stats_role_access enable row level security;
-- aucune policy => aucun accès anon/authenticated, service_role uniquement

-- ── 6. Index de lecture sur activity_logs ───────────────────
create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);
create index if not exists activity_logs_action_pattern_idx
  on public.activity_logs (action text_pattern_ops);
create index if not exists activity_logs_email_idx
  on public.activity_logs (email);

-- ============================================================
--  SEED
-- ============================================================

insert into public.stats_roles (key, label, sort_order) values
  ('direction',        'Direction',         10),
  ('resp_commercial',  'Resp Commercial',   20),
  ('resp_adv',         'Resp ADV',          30),
  ('resp_partenaire',  'Resp Partenaire',   40),
  ('resp_pricing',     'Resp Pricing',      50)
on conflict (key) do update set label = excluded.label, sort_order = excluded.sort_order;

-- ── Définition : Contrats MINT ──────────────────────────────
insert into public.stats_definitions (key, app_slug, label, description, icon, sort_order, match, config)
values (
  'contrats_mint', 'contrats',
  'Contrats MINT', 'Contrats générés depuis l''application Contrats', 'description', 10,
  $m${"mode":"prefix","values":["Contrat généré"]}$m$::jsonb,
  $c${
    "kpis":[
      {"label":"Contrats générés","type":"count"},
      {"label":"Utilisateurs actifs","type":"distinct","field":"email"},
      {"label":"Moyenne / utilisateur","type":"avg_per","field":"email","decimals":1}
    ],
    "breakdowns":[
      {"key":"by_user","label":"Contrats par utilisateur","header":"Utilisateur","field":"email",
       "columns":["count","share","chips:details.segment","last"]},
      {"key":"by_segment","label":"Répartition par segment","header":"Segment","field":"details.segment",
       "fallback":"N/A","transform":"upper","columns":["count","share","distinct:email","last"]}
    ],
    "detail":{
      "columns":[
        {"label":"Date","field":"created_at","type":"datetime"},
        {"label":"Utilisateur","field":"email"},
        {"label":"Action","field":"action"},
        {"label":"Segment","field":"details.segment","type":"chip","transform":"upper"}
      ],
      "search":["email","action","details.segment"]
    }
  }$c$::jsonb
) on conflict (key) do update set
  app_slug=excluded.app_slug, label=excluded.label, description=excluded.description,
  icon=excluded.icon, sort_order=excluded.sort_order, match=excluded.match,
  config=excluded.config, updated_at=now();

-- ── Définition : Contrats GDB / Retour de gain ──────────────
insert into public.stats_definitions (key, app_slug, label, description, icon, sort_order, match, config)
values (
  'contrats_gdb', 'contrats',
  'Contrats GDB & retours de gain', 'Contrats GDB et retours de gain générés', 'request_quote', 20,
  $m${"mode":"prefix","values":["Contrat GDB généré","Retour gain GDB généré"]}$m$::jsonb,
  $c${
    "categories":[
      {"key":"contrat","label":"Contrat GDB","color":"blue","match":{"mode":"prefix","values":["Contrat GDB généré"]}},
      {"key":"retour","label":"Retour de gain","color":"green","match":{"mode":"prefix","values":["Retour gain GDB généré"]}}
    ],
    "kpis":[
      {"label":"Documents générés","type":"count"},
      {"label":"Contrats GDB","type":"count_category","category":"contrat"},
      {"label":"Retours de gain","type":"count_category","category":"retour","color":"green"},
      {"label":"Utilisateurs actifs","type":"distinct","field":"email"}
    ],
    "breakdowns":[
      {"key":"by_user","label":"Documents par utilisateur","header":"Utilisateur","field":"email",
       "columns":["count","share","categories","last"]}
    ],
    "detail":{
      "columns":[
        {"label":"Date","field":"created_at","type":"datetime"},
        {"label":"Type","field":"__category","type":"category"},
        {"label":"Utilisateur","field":"email"},
        {"label":"Document","field":"action"}
      ],
      "search":["email","action"]
    }
  }$c$::jsonb
) on conflict (key) do update set
  app_slug=excluded.app_slug, label=excluded.label, description=excluded.description,
  icon=excluded.icon, sort_order=excluded.sort_order, match=excluded.match,
  config=excluded.config, updated_at=now();

-- ── Définition : Sélection Fournisseurs ─────────────────────
insert into public.stats_definitions (key, app_slug, label, description, icon, sort_order, match, config)
values (
  'fournisseurs_transmis', 'fournisseur',
  'Sélection Fournisseurs', 'Transmissions de fournisseurs par dossier', 'bolt', 30,
  $m${"mode":"equals","values":["Fournisseurs transmis"]}$m$::jsonb,
  $c${
    "kpis":[
      {"label":"Transmissions","type":"count"},
      {"label":"Utilisateurs actifs","type":"distinct","field":"email"},
      {"label":"Fournisseurs distincts","type":"distinct_multi","field":"details.fournisseurs"},
      {"label":"Moy. fournisseurs / transmission","type":"avg","field":"details.count","decimals":1}
    ],
    "breakdowns":[
      {"key":"by_user","label":"Transmissions par utilisateur","header":"Utilisateur","field":"email",
       "columns":["count","share","distinct:details.ref_dossier","last"]},
      {"key":"by_fournisseur","label":"Fournisseurs les plus transmis","header":"Fournisseur",
       "field":"details.fournisseurs","multi":true,"limit":25,
       "columns":["count","share","distinct:email","last"]},
      {"key":"by_energie","label":"Par énergie","header":"Énergie","field":"details.energie",
       "transform":"upper","fallback":"N/A","columns":["count","share","last"]},
      {"key":"by_segment","label":"Par segment","header":"Segment","field":"details.segment",
       "transform":"upper","fallback":"N/A","columns":["count","share","last"]}
    ],
    "detail":{
      "columns":[
        {"label":"Date","field":"created_at","type":"datetime"},
        {"label":"Utilisateur","field":"email"},
        {"label":"Référence dossier","field":"details.ref_dossier","type":"ref"},
        {"label":"Fournisseurs","field":"details.fournisseurs","type":"list"},
        {"label":"Énergie","field":"details.energie","type":"chip","transform":"upper"},
        {"label":"Segment","field":"details.segment","type":"chip","transform":"upper"},
        {"label":"Note crédit","field":"details.note"},
        {"label":"Volume (MWh)","field":"details.volume"},
        {"label":"DDF","field":"details.ddf"},
        {"label":"DFF","field":"details.dff"},
        {"label":"Syndic","field":"details.syndic"},
        {"label":"Fournisseur actuel","field":"details.fournisseur_actuel"},
        {"label":"Commentaire","field":"details.commentaire","type":"note"}
      ],
      "search":["details.ref_dossier","details.commentaire","email"]
    }
  }$c$::jsonb
) on conflict (key) do update set
  app_slug=excluded.app_slug, label=excluded.label, description=excluded.description,
  icon=excluded.icon, sort_order=excluded.sort_order, match=excluded.match,
  config=excluded.config, updated_at=now();

-- ── Définition : Box des prix ───────────────────────────────
insert into public.stats_definitions (key, app_slug, label, description, icon, sort_order, match, config)
values (
  'box_prix', 'box-prix',
  'Box des prix', 'Consultations, exports PDF et taux de transformation', 'plagiarism', 40,
  $m${"mode":"in","values":["Box prix consultée","Box prix exportée"]}$m$::jsonb,
  $c${
    "categories":[
      {"key":"consult","label":"Consultation","color":"brown","match":{"mode":"equals","values":["Box prix consultée"]}},
      {"key":"export","label":"Export PDF","color":"green","match":{"mode":"equals","values":["Box prix exportée"]}}
    ],
    "kpis":[
      {"label":"Consultations","type":"count_category","category":"consult"},
      {"label":"Exports PDF","type":"count_category","category":"export","color":"green"},
      {"label":"Taux de transformation","type":"rate","num":"export","den":"consult","color":"orange"},
      {"label":"Sales actifs","type":"distinct","field":"email"},
      {"label":"Comptes clients","type":"distinct","field":"details.compte","fallback":"N/A"}
    ],
    "breakdowns":[
      {"key":"by_user","label":"Utilisation par Sales","header":"Utilisateur","field":"email",
       "columns":["count","share","categories","rate:export:consult","distinct:details.compte","last"]},
      {"key":"by_compte","label":"Top comptes clients","header":"Compte client","field":"details.compte",
       "fallback":"N/A","limit":25,"columns":["count","categories","distinct:email","last"]}
    ],
    "detail":{
      "columns":[
        {"label":"Date","field":"created_at","type":"datetime"},
        {"label":"Type","field":"__category","type":"category"},
        {"label":"Utilisateur","field":"email"},
        {"label":"Compte client","field":"details.compte"},
        {"label":"Énergie","field":"details.energie","type":"chip","transform":"upper"},
        {"label":"Segment","field":"details.segment","type":"chip","transform":"upper"},
        {"label":"Référence dossier","field":"details.ref_dossier","type":"ref"}
      ],
      "search":["details.compte","email","details.ref_dossier"]
    }
  }$c$::jsonb
) on conflict (key) do update set
  app_slug=excluded.app_slug, label=excluded.label, description=excluded.description,
  icon=excluded.icon, sort_order=excluded.sort_order, match=excluded.match,
  config=excluded.config, updated_at=now();

-- ── Définition : Accès aux applications (transverse) ────────
insert into public.stats_definitions (key, app_slug, label, description, icon, sort_order, match, config)
values (
  'acces_applications', null,
  'Accès aux applications', 'Ouvertures d''applications depuis le hub', 'apps', 50,
  $m${"mode":"prefix","values":["Accès à l'application"]}$m$::jsonb,
  $c${
    "kpis":[
      {"label":"Accès","type":"count"},
      {"label":"Utilisateurs actifs","type":"distinct","field":"email"},
      {"label":"Applications utilisées","type":"distinct","field":"action","extract":"\"([^\"]+)\""}
    ],
    "breakdowns":[
      {"key":"by_app","label":"Accès par application","header":"Application","field":"action",
       "extract":"\"([^\"]+)\"","columns":["count","share","distinct:email","last"]},
      {"key":"by_user","label":"Accès par utilisateur","header":"Utilisateur","field":"email",
       "columns":["count","share","last"]}
    ],
    "detail":{
      "columns":[
        {"label":"Date","field":"created_at","type":"datetime"},
        {"label":"Utilisateur","field":"email"},
        {"label":"Application","field":"action","extract":"\"([^\"]+)\"","type":"chip"}
      ],
      "search":["email","action"]
    }
  }$c$::jsonb
) on conflict (key) do update set
  app_slug=excluded.app_slug, label=excluded.label, description=excluded.description,
  icon=excluded.icon, sort_order=excluded.sort_order, match=excluded.match,
  config=excluded.config, updated_at=now();

-- ── Matrice d'accès par défaut ──────────────────────────────
insert into public.stats_role_access (role_key, definition_key, scope) values
  -- Direction : tout
  ('direction','contrats_mint','all'),
  ('direction','contrats_gdb','all'),
  ('direction','fournisseurs_transmis','all'),
  ('direction','box_prix','all'),
  ('direction','acces_applications','all'),
  -- Resp Commercial : production commerciale + outils sales
  ('resp_commercial','contrats_mint','all'),
  ('resp_commercial','contrats_gdb','all'),
  ('resp_commercial','fournisseurs_transmis','all'),
  ('resp_commercial','box_prix','all'),
  ('resp_commercial','acces_applications','all'),
  -- Resp ADV : contractualisation
  ('resp_adv','contrats_mint','all'),
  ('resp_adv','contrats_gdb','all'),
  ('resp_adv','acces_applications','all'),
  -- Resp Partenaire : transmissions fournisseurs
  ('resp_partenaire','fournisseurs_transmis','all'),
  ('resp_partenaire','acces_applications','all'),
  -- Resp Pricing : prix et sélection
  ('resp_pricing','box_prix','all'),
  ('resp_pricing','fournisseurs_transmis','all'),
  ('resp_pricing','acces_applications','all')
on conflict (role_key, definition_key) do update set scope = excluded.scope;

-- ── Enregistrement de l'app dans le hub ────────────────────
insert into public.applications (name, slug, url, active)
values ('Statistiques', 'stats', 'https://capitole-stats.vercel.app', true)
on conflict (slug) do update set name = excluded.name, active = true;

-- ── Les admins reçoivent l'accès à l'app + le périmètre complet
insert into public.user_permissions (user_id, app_id)
select p.id, a.id
from public.profiles p
cross join public.applications a
where a.slug = 'stats'
  and p.role = 'admin'
  and not exists (
    select 1 from public.user_permissions up
    where up.user_id = p.id and up.app_id = a.id
  );
