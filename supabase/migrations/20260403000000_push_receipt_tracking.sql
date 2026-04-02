-- =============================================================================
-- Push Receipt Tracking
-- Adds ticket_id tracking to notification_log for Expo receipt checking.
-- Each hourly cron run checks receipts from the previous run's tickets.
-- =============================================================================

-- Add ticket tracking columns to notification_log
ALTER TABLE notification_log
  ADD COLUMN ticket_id text,
  ADD COLUMN token text,
  ADD COLUMN receipt_checked boolean NOT NULL DEFAULT false;

-- Index for finding unchecked receipts efficiently
CREATE INDEX idx_notification_log_unchecked_receipts
  ON notification_log (receipt_checked, sent_at)
  WHERE receipt_checked = false AND ticket_id IS NOT NULL;
