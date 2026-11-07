CREATE TABLE IF NOT EXISTS docs (
  k TEXT PRIMARY KEY,          -- "profile" or "log-YYYY-MM-DD"
  v TEXT NOT NULL,             -- JSON
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subs (
  endpoint TEXT PRIMARY KEY,
  sub TEXT NOT NULL,           -- PushSubscription JSON
  created INTEGER NOT NULL
);
