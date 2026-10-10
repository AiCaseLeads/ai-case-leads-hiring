import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const hubOauthStates=sqliteTable("hub_oauth_states",{
  stateHash:text("state_hash").primaryKey(),userId:text("user_id").notNull(),verifier:text("verifier").notNull(),expiresAt:integer("expires_at").notNull(),usedAt:integer("used_at"),
},table=>[index("hub_oauth_expiry_idx").on(table.expiresAt)]);
