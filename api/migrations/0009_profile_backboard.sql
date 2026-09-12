-- One Backboard assistant per user holds that user's coach memories (Backboard scopes memory per
-- assistant). The id is created lazily on the first check-in.
alter table profiles add column if not exists backboard_assistant_id text;
