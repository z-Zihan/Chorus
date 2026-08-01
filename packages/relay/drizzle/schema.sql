-- The relay creates these tables idempotently at startup. This file is retained
-- in the runtime image as the canonical deployment schema reference.
CREATE TABLE hubs (hub_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, display_name TEXT NOT NULL, online INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE offline_messages (id TEXT PRIMARY KEY, to_hub_id TEXT NOT NULL, envelope TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE room_members (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, PRIMARY KEY (room_id, hub_id));
