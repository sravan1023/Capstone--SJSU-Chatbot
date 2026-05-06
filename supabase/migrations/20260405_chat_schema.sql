-- ============================================================
-- Chat Feature Migration

-- 1. Tables

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

-- 2. Indexes

create index if not exists idx_conversations_user_updated
on conversations(user_id, updated_at desc);

create index if not exists idx_messages_conversation_created
on messages(conversation_id, created_at desc);

-- 3. Row Level Security

alter table conversations enable row level security;

create policy "users can view own conversations"
on conversations for select
using (user_id = auth.uid());

create policy "users can insert own conversations"
on conversations for insert
with check (user_id = auth.uid());

create policy "users can update own conversations"
on conversations for update
using (user_id = auth.uid());

create policy "users can delete own conversations"
on conversations for delete
using (user_id = auth.uid());

alter table messages enable row level security;

create policy "users can view messages in own conversations"
on messages for select
using (
  exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

create policy "users can insert messages in own conversations"
on messages for insert
with check (
  exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);

create policy "users can delete messages in own conversations"
on messages for delete
using (
  exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and c.user_id = auth.uid()
  )
);