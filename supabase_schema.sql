-- Stack n Stock CRM Dashboard V1
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  company_type text,
  contact_name text,
  contact_email text,
  contact_phone text,
  owner text,
  city text default 'Bangalore',
  stage text not null default 'Prospecting' check (stage in ('Prospecting','Qualified','Proposal','Pilot','Won','Lost')),
  deal_value numeric not null default 0,
  probability integer not null default 15 check (probability >= 0 and probability <= 100),
  score integer not null default 70 check (score >= 0 and score <= 100),
  next_action_at date,
  next_action text,
  notes text
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_accounts_set_updated_at on public.crm_accounts;
create trigger crm_accounts_set_updated_at
before update on public.crm_accounts
for each row execute function public.set_updated_at();

alter table public.crm_accounts enable row level security;

drop policy if exists "crm_accounts_select" on public.crm_accounts;
drop policy if exists "crm_accounts_insert" on public.crm_accounts;
drop policy if exists "crm_accounts_update" on public.crm_accounts;
drop policy if exists "crm_accounts_delete" on public.crm_accounts;

-- V1 prototype policies for an internal static dashboard.
-- Before public release, replace these with authenticated policies.
create policy "crm_accounts_select" on public.crm_accounts for select using (true);
create policy "crm_accounts_insert" on public.crm_accounts for insert with check (true);
create policy "crm_accounts_update" on public.crm_accounts for update using (true) with check (true);
create policy "crm_accounts_delete" on public.crm_accounts for delete using (true);

create index if not exists crm_accounts_stage_idx on public.crm_accounts(stage);
create index if not exists crm_accounts_owner_idx on public.crm_accounts(owner);
create index if not exists crm_accounts_next_action_idx on public.crm_accounts(next_action_at);

-- V2 dynamic extensions (idempotent)
alter table public.crm_accounts add column if not exists legacy_id text unique;
alter table public.crm_accounts add column if not exists priority_tier text not null default 'P2';
alter table public.crm_accounts add column if not exists action text not null default 'Shortlist';
alter table public.crm_accounts add column if not exists demand_low integer not null default 0;
alter table public.crm_accounts add column if not exists demand_high integer not null default 0;
alter table public.crm_accounts add column if not exists channels jsonb not null default '[]'::jsonb;
alter table public.crm_accounts add column if not exists channel_share_note text;
alter table public.crm_accounts add column if not exists competitors_serving jsonb not null default '[]'::jsonb;
alter table public.crm_accounts add column if not exists competitor_wallet_share text;
alter table public.crm_accounts add column if not exists score_qc_urgency smallint not null default 3;
alter table public.crm_accounts add column if not exists score_sku_fit smallint not null default 3;
alter table public.crm_accounts add column if not exists score_order_density smallint not null default 3;
alter table public.crm_accounts add column if not exists score_pilot_willing smallint not null default 3;
alter table public.crm_accounts add column if not exists score_accessibility smallint not null default 3;
alter table public.crm_accounts add column if not exists score_logo_value smallint not null default 3;
alter table public.crm_accounts add column if not exists qc_score integer not null default 0;
alter table public.crm_accounts add column if not exists bin_slots integer not null default 0;
alter table public.crm_accounts add column if not exists price_per_bin integer not null default 1500;
alter table public.crm_accounts add column if not exists weighted_mrr numeric not null default 0;
alter table public.crm_accounts add column if not exists fu1_date date;
alter table public.crm_accounts add column if not exists fu1_contact text;
alter table public.crm_accounts add column if not exists fu1_mode text not null default 'Call';
alter table public.crm_accounts add column if not exists fu1_status text not null default 'Pending';
alter table public.crm_accounts add column if not exists fu1_note text;
alter table public.crm_accounts add column if not exists fu2_date date;
alter table public.crm_accounts add column if not exists fu2_contact text;
alter table public.crm_accounts add column if not exists fu2_mode text not null default 'Email';
alter table public.crm_accounts add column if not exists fu2_status text not null default 'Pending';
alter table public.crm_accounts add column if not exists fu2_note text;
alter table public.crm_accounts add column if not exists next_followup_date date;
alter table public.crm_accounts add column if not exists commercial_ask text;
alter table public.crm_accounts add column if not exists risks text;
alter table public.crm_accounts add column if not exists score_basis text;
alter table public.crm_accounts add column if not exists last_contact_at date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_accounts_priority_tier_chk'
  ) then
    alter table public.crm_accounts
      add constraint crm_accounts_priority_tier_chk
      check (priority_tier in ('P0','P1','P2','P3'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_accounts_action_chk'
  ) then
    alter table public.crm_accounts
      add constraint crm_accounts_action_chk
      check (action in ('Approach week later','Approach now','Shortlist','Validate'));
  end if;
end $$;

create index if not exists crm_accounts_priority_tier_idx on public.crm_accounts(priority_tier);
create index if not exists crm_accounts_action_idx on public.crm_accounts(action);
create index if not exists crm_accounts_qc_score_idx on public.crm_accounts(qc_score);
create index if not exists crm_accounts_weighted_mrr_idx on public.crm_accounts(weighted_mrr);
create index if not exists crm_accounts_channels_idx on public.crm_accounts using gin(channels);
create index if not exists crm_accounts_competitors_idx on public.crm_accounts using gin(competitors_serving);

create table if not exists public.crm_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null default 'q-commerce',
  avg_order_value integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  market_share_pct numeric(5,2) not null default 0,
  customers_served jsonb not null default '[]'::jsonb,
  channels jsonb not null default '[]'::jsonb,
  strengths text,
  weaknesses text,
  pricing_model text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_competitors_customers_served_idx on public.crm_competitors using gin(customers_served);
create index if not exists crm_competitors_channels_idx on public.crm_competitors using gin(channels);

drop trigger if exists crm_channels_set_updated_at on public.crm_channels;
create trigger crm_channels_set_updated_at
before update on public.crm_channels
for each row execute function public.set_updated_at();

drop trigger if exists crm_competitors_set_updated_at on public.crm_competitors;
create trigger crm_competitors_set_updated_at
before update on public.crm_competitors
for each row execute function public.set_updated_at();

alter table public.crm_channels enable row level security;
alter table public.crm_competitors enable row level security;

drop policy if exists "crm_channels_select" on public.crm_channels;
drop policy if exists "crm_channels_insert" on public.crm_channels;
drop policy if exists "crm_channels_update" on public.crm_channels;
drop policy if exists "crm_channels_delete" on public.crm_channels;
create policy "crm_channels_select" on public.crm_channels for select using (true);
create policy "crm_channels_insert" on public.crm_channels for insert with check (true);
create policy "crm_channels_update" on public.crm_channels for update using (true) with check (true);
create policy "crm_channels_delete" on public.crm_channels for delete using (true);

drop policy if exists "crm_competitors_select" on public.crm_competitors;
drop policy if exists "crm_competitors_insert" on public.crm_competitors;
drop policy if exists "crm_competitors_update" on public.crm_competitors;
drop policy if exists "crm_competitors_delete" on public.crm_competitors;
create policy "crm_competitors_select" on public.crm_competitors for select using (true);
create policy "crm_competitors_insert" on public.crm_competitors for insert with check (true);
create policy "crm_competitors_update" on public.crm_competitors for update using (true) with check (true);
create policy "crm_competitors_delete" on public.crm_competitors for delete using (true);

create or replace function public.crm_accounts_compute_fields()
returns trigger
language plpgsql
as $$
begin
  new.qc_score := round((
    (coalesce(new.score_qc_urgency, 3) * 15) +
    (coalesce(new.score_sku_fit, 3) * 20) +
    (coalesce(new.score_order_density, 3) * 15) +
    (coalesce(new.score_pilot_willing, 3) * 15) +
    (coalesce(new.score_accessibility, 3) * 15) +
    (coalesce(new.score_logo_value, 3) * 20)
  ) / 5.0);

  new.weighted_mrr := round(coalesce(new.bin_slots,0) * coalesce(new.price_per_bin,1500) * (coalesce(new.probability,0) / 100.0));
  new.score := coalesce(new.qc_score, new.score, 0);
  return new;
end;
$$;

drop trigger if exists crm_accounts_compute_fields_trigger on public.crm_accounts;
create trigger crm_accounts_compute_fields_trigger
before insert or update on public.crm_accounts
for each row execute function public.crm_accounts_compute_fields();

create or replace function public.sync_competitor_overlap_to_accounts()
returns trigger
language plpgsql
as $$
begin
  update public.crm_accounts a
  set competitors_serving = coalesce((
    select jsonb_agg(c.id)
    from public.crm_competitors c
    where c.customers_served ? a.id::text
  ), '[]'::jsonb);

  return null;
end;
$$;

drop trigger if exists crm_competitor_overlap_sync on public.crm_competitors;
create trigger crm_competitor_overlap_sync
after insert or update or delete on public.crm_competitors
for each statement execute function public.sync_competitor_overlap_to_accounts();

insert into public.crm_channels(name,type)
values
('Blinkit','q-commerce'),
('Zepto','q-commerce'),
('Instamart','q-commerce'),
('BB Now','q-commerce'),
('Swiggy Instamart','q-commerce'),
('Amazon','marketplace'),
('Flipkart','marketplace'),
('D2C','direct'),
('Nykaa','marketplace'),
('Own Store','direct')
on conflict (name) do nothing;

insert into public.crm_accounts
(name, company_type, contact_name, contact_email, contact_phone, owner, city, stage, deal_value, probability, score, next_action_at, next_action, notes)
values
('Haldiram Bangalore','Packaged Food / Snacks','Regional Distributor','ops@haldiram.example','+91 90000 10001','Abhinand','Bangalore','Pilot',850000,75,94,current_date + 1,'Confirm pilot SKU list','Anchor snack VMI pilot for fast-moving SKUs.'),
('Himalaya Wellness','Wellness / Personal Care','Supply Chain Lead','supply@himalaya.example','+91 90000 10002','Abhinand','Bangalore','Proposal',620000,55,88,current_date + 3,'Send layout and pricing note','Compact wellness SKU pilot.'),
('ITC Foods Distributor','FMCG Distributor','Modern Trade Contact','trade@itc.example','+91 90000 10006','Ops','Bangalore','Won',1250000,100,91,current_date,'Kickoff data collection','Confirmed for discovery pilot.'),
('Supertails','Pet Care','Business Head','partners@supertails.example','+91 90000 10003','Sales','Bangalore','Qualified',420000,30,81,current_date + 5,'Qualify compact SKU list','Pet essentials only, exclude bulky bags.'),
('Purplle Marketplace Sellers','Beauty Marketplace','Marketplace Ops','marketplace@purplle.example','+91 90000 10005','Abhinand','Bangalore','Proposal',1100000,55,86,current_date + 2,'Present seller pool model','100-bin beauty marketplace pool for fast-moving seller inventory.')
on conflict do nothing;
