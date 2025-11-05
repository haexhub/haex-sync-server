-- Enable Row Level Security on sync tables
ALTER TABLE vault_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can only access their own vault keys" ON vault_keys;
DROP POLICY IF EXISTS "Users can only insert their own vault keys" ON vault_keys;
DROP POLICY IF EXISTS "Users can only update their own vault keys" ON vault_keys;
DROP POLICY IF EXISTS "Users can only access their own sync logs" ON sync_logs;
DROP POLICY IF EXISTS "Users can only insert their own sync logs" ON sync_logs;

-- Vault Keys Policies
CREATE POLICY "Users can only access their own vault keys"
  ON vault_keys
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own vault keys"
  ON vault_keys
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own vault keys"
  ON vault_keys
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Sync Logs Policies
CREATE POLICY "Users can only access their own sync logs"
  ON sync_logs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own sync logs"
  ON sync_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Note: No UPDATE or DELETE policies for sync_logs - they are append-only
