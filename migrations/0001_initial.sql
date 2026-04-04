CREATE TABLE IF NOT EXISTS jingles (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_content_type TEXT NOT NULL,
  audio_key TEXT,
  audio_content_type TEXT,
  votes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  replicate_prediction_id TEXT,
  replicate_output_url TEXT,
  replicate_web_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jingles_votes_created_idx
ON jingles (votes DESC, created_at DESC);
