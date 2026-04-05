ALTER TABLE jingles ADD COLUMN video_key TEXT;
ALTER TABLE jingles ADD COLUMN video_content_type TEXT;
ALTER TABLE jingles ADD COLUMN video_status TEXT;   -- null | queued | processing | succeeded | failed
ALTER TABLE jingles ADD COLUMN video_error TEXT;
ALTER TABLE jingles ADD COLUMN video_replicate_id TEXT;
