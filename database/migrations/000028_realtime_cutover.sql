-- migrate:transaction true

-- Realtime correctness is snapshot-based, so no historical event replay is
-- required at cutover. Current state is read after stream.ready; this row only
-- enables future domain mutations to create durable REALTIME dispatches.
INSERT INTO infra.destination_activations (
  destination, activated_at, activated_by_revision
) VALUES ('REALTIME', statement_timestamp(), 28)
ON CONFLICT (destination) DO NOTHING;
