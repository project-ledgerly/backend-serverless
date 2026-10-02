-- Row level security on every table, with no policies.
--
-- Supabase publishes the public schema through a REST API that anyone holding
-- the project's anon key can call, and tables created by migrations are open
-- to it by default. With RLS on and no policies, that API sees nothing.
-- The backend connects as the table owner, which bypasses RLS, so it is not
-- affected. New tables must be added here (or in their own migration).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
