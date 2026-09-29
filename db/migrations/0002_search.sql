-- Search over the owner's own records ("Poocho").
--
-- A document is one thing the owner can ask about: an issued bill, a contract, an old bill they
-- uploaded.  Its text is cut into chunks; each chunk is always searchable by words (tsvector,
-- 'simple' config so names and Hinglish are not stemmed into nonsense) and, when an OpenAI key is
-- configured, by meaning (pgvector).  Documents derived from records carry the record's
-- updatedAt, so a changed bill is re-indexed and a deleted record takes its document with it.

create extension if not exists vector;

create table documents (
  business_id        text not null references businesses(id) on delete cascade,
  id                 text not null,
  kind               text not null check (kind in ('bill', 'project', 'upload')),
  source_id          text,
  title              text not null,
  source_updated_at  text,
  created_at         timestamptz not null default now(),
  data               jsonb not null default '{}'::jsonb,
  primary key (business_id, id)
);
create unique index documents_source on documents (business_id, kind, source_id) where source_id is not null;

create table chunks (
  business_id  text not null,
  document_id  text not null,
  ord          integer not null,
  text         text not null,
  tsv          tsvector generated always as (to_tsvector('simple', text)) stored,
  embedding    vector(1536),
  model        text,
  primary key (business_id, document_id, ord),
  foreign key (business_id, document_id) references documents (business_id, id) on delete cascade
);
create index chunks_tsv on chunks using gin (tsv);
create index chunks_embedding on chunks using hnsw (embedding vector_cosine_ops);
