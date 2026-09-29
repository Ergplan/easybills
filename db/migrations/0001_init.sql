-- EkBill schema, version 1.
--
-- Each record keeps its full shape in `data` (the TypeScript types in src/lib/domain/types.ts),
-- and every field the app filters, sorts or enforces a rule on is a GENERATED column read out of
-- it.  Generated columns cannot drift from the record: there is one write, and Postgres derives
-- the rest.  Rules that must hold whatever the code does -- one business per record, one bill per
-- number per year -- are constraints here, not checks in TypeScript.

create table businesses (
  id          text primary key,
  data        jsonb not null,
  created_at  text generated always as (data->>'createdAt') stored
);

create table users (
  uid   text primary key,
  data  jsonb not null
);

create table members (
  business_id text not null references businesses(id) on delete cascade,
  uid         text not null,
  data        jsonb not null,
  primary key (business_id, uid)
);
create index members_uid on members (uid);

create table customers (
  business_id     text not null references businesses(id) on delete cascade,
  id              text not null,
  data            jsonb not null,
  name            text generated always as (data->>'name') stored,
  archived        boolean generated always as ((data->>'archived')::boolean) stored,
  last_billed_at  text generated always as (data->>'lastBilledAt') stored,
  primary key (business_id, id)
);
create index customers_name on customers (business_id, name);

create table items (
  business_id   text not null references businesses(id) on delete cascade,
  id            text not null,
  data          jsonb not null,
  last_used_at  text generated always as (data->>'lastUsedAt') stored,
  primary key (business_id, id)
);

create table invoices (
  business_id     text not null references businesses(id) on delete cascade,
  id              text not null,
  data            jsonb not null,
  status          text generated always as (data->>'status') stored,
  payment_status  text generated always as (data->>'paymentStatus') stored,
  customer_id     text generated always as (data->'customer'->>'customerId') stored,
  issue_date      text generated always as (data->>'issueDate') stored,
  updated_at      text generated always as (data->>'updatedAt') stored,
  number          text generated always as (data->>'number') stored,
  financial_year  text generated always as (data->>'financialYear') stored,
  number_sequence integer generated always as ((data->>'numberSequence')::integer) stored,
  project_id      text generated always as (data->>'projectId') stored,
  primary key (business_id, id)
);
-- A number, once printed on a bill, is never printed on another in the same year -- cancelled
-- bills included, because a cancelled bill still exists and still carries it.
create unique index invoices_number_once on invoices (business_id, financial_year, number) where number is not null;
create index invoices_status_date on invoices (business_id, status, issue_date);
create index invoices_customer on invoices (business_id, customer_id, status);
create index invoices_updated on invoices (business_id, updated_at desc);
create index invoices_project on invoices (business_id, project_id) where project_id is not null;

create table payments (
  business_id  text not null references businesses(id) on delete cascade,
  id           text not null,
  data         jsonb not null,
  customer_id  text generated always as (data->>'customerId') stored,
  created_at   text generated always as (data->>'createdAt') stored,
  primary key (business_id, id)
);
create index payments_created on payments (business_id, created_at desc);
create index payments_allocations on payments using gin ((data->'allocations') jsonb_path_ops);

create table adjustments (
  business_id  text not null references businesses(id) on delete cascade,
  id           text not null,
  data         jsonb not null,
  invoice_id   text generated always as (data->>'invoiceId') stored,
  kind         text generated always as (data->>'kind') stored,
  number       text generated always as (data->>'number') stored,
  financial_year text generated always as (data->>'financialYear') stored,
  created_at   text generated always as (data->>'createdAt') stored,
  primary key (business_id, id)
);
create index adjustments_invoice on adjustments (business_id, invoice_id);
create unique index adjustments_number_once on adjustments (business_id, kind, financial_year, number) where number is not null;

-- Number series.  `id` is e.g. "default__2026-27" or "credit-note__2026-27".
create table counters (
  business_id  text not null references businesses(id) on delete cascade,
  id           text not null,
  next_number  integer not null check (next_number >= 1),
  updated_at   timestamptz not null default now(),
  primary key (business_id, id)
);

create table projects (
  business_id  text not null references businesses(id) on delete cascade,
  id           text not null,
  data         jsonb not null,
  customer_id  text generated always as (data->>'customerId') stored,
  primary key (business_id, id)
);
create index projects_customer on projects (business_id, customer_id);

-- Append-only.  Nothing in the app updates or deletes a row here.
create table audit_events (
  business_id  text not null references businesses(id) on delete cascade,
  id           text not null,
  at           timestamptz not null,
  data         jsonb not null,
  primary key (business_id, id)
);
create index audit_events_at on audit_events (business_id, at desc);

create table ai_usage (
  business_id  text not null references businesses(id) on delete cascade,
  key          text not null,
  count        integer not null,
  expires_at   timestamptz not null,
  primary key (business_id, key)
);
