-- Customer-provided service-account credentials are encrypted by the application.
-- Verifying access never enables synchronization: a pilot still needs explicit review.
ALTER TABLE public.audit_rose_connections
 ADD COLUMN IF NOT EXISTS credentials_ciphertext text,
 ADD COLUMN IF NOT EXISTS connected_at timestamptz,
 ADD COLUMN IF NOT EXISTS connected_by uuid REFERENCES auth.users(id),
 ADD COLUMN IF NOT EXISTS connection_state text NOT NULL DEFAULT 'pending'
  CHECK (connection_state IN ('pending','connected','disconnected'));
