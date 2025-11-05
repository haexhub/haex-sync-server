import {
  pgTable,
  pgSchema,
  text,
  timestamp,
  uuid,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Define Supabase auth schema
const authSchema = pgSchema("auth");

// Reference to auth.users table from Supabase
// We only define the columns we need for foreign key references
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

/**
 * Vault Keys Table
 * Stores encrypted vault keys for each user
 * The vault_key is encrypted with the user's password-derived key (Hybrid-Ansatz)
 * References auth.users from Supabase Auth
 */
export const vaultKeys = pgTable(
  "vault_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    vaultId: text("vault_id").notNull(),
    encryptedVaultKey: text("encrypted_vault_key").notNull(), // Base64 of AES-GCM encrypted key
    salt: text("salt").notNull(), // For PBKDF2 key derivation
    nonce: text("nonce").notNull(), // For AES-GCM encryption
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vault_keys_user_vault_idx").on(table.userId, table.vaultId),
    index("vault_keys_user_idx").on(table.userId),
  ]
);

/**
 * Sync Logs Table
 * Stores encrypted CRDT log entries for synchronization
 * Each entry is encrypted end-to-end with the vault key
 * References auth.users from Supabase Auth
 */
export const syncLogs = pgTable(
  "sync_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    vaultId: text("vault_id").notNull(),

    // Encrypted CRDT log entry (encrypted with vault key on client)
    encryptedData: text("encrypted_data").notNull(),
    nonce: text("nonce").notNull(), // IV for AES-GCM

    // Metadata for sync (unencrypted for filtering/sorting)
    haexTimestamp: text("haex_timestamp").notNull(), // HLC timestamp from client
    sequence: integer("sequence").notNull(), // Auto-incrementing sequence per user

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("sync_logs_user_vault_idx").on(table.userId, table.vaultId),
    index("sync_logs_user_seq_idx").on(table.userId, table.sequence),
    index("sync_logs_timestamp_idx").on(table.haexTimestamp),
    uniqueIndex("sync_logs_user_timestamp_idx").on(
      table.userId,
      table.haexTimestamp
    ),
  ]
);

// Type exports for TypeScript
export type VaultKey = typeof vaultKeys.$inferSelect;
export type NewVaultKey = typeof vaultKeys.$inferInsert;

export type SyncLog = typeof syncLogs.$inferSelect;
export type NewSyncLog = typeof syncLogs.$inferInsert;
