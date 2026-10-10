-- migrate:transaction true

-- The TABLE return columns of this PL/pgSQL function are variables in the
-- function scope. Qualify the sessions column used by the non-rotation path so
-- PostgreSQL does not confuse it with the absolute_expires_at output variable.
CREATE OR REPLACE FUNCTION security_api.touch_or_rotate_session(
  p_token_digest bytea,
  p_new_token_digest bytea,
  p_idle_expires_at timestamptz,
  p_rotation_grace_expires_at timestamptz
)
RETURNS TABLE (session_id uuid, rotated boolean, absolute_expires_at timestamptz, idle_expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_session auth.sessions%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_session FROM auth.sessions
  WHERE token_digest = p_token_digest AND revoked_at IS NULL
  FOR UPDATE;
  IF v_session.id IS NULL
    OR v_session.absolute_expires_at <= statement_timestamp()
    OR v_session.idle_expires_at <= statement_timestamp()
    OR (v_session.rotated_to_session_id IS NOT NULL AND v_session.rotation_grace_expires_at <= statement_timestamp())
  THEN RETURN; END IF;

  IF v_session.created_at <= statement_timestamp() - interval '24 hours'
    AND v_session.rotated_to_session_id IS NULL
  THEN
    INSERT INTO auth.sessions (
      owner_id, token_digest, issued_password_version, expires_at, absolute_expires_at,
      idle_expires_at, last_seen_at, rotated_from_session_id
    ) VALUES (
      v_session.owner_id, p_new_token_digest, v_session.issued_password_version,
      v_session.absolute_expires_at, v_session.absolute_expires_at,
      LEAST(p_idle_expires_at, v_session.absolute_expires_at), statement_timestamp(), v_session.id
    ) RETURNING id INTO v_new_id;
    UPDATE auth.sessions SET
      rotated_to_session_id = v_new_id,
      rotation_grace_expires_at = p_rotation_grace_expires_at,
      last_seen_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE id = v_session.id;
    RETURN QUERY SELECT v_new_id, true, v_session.absolute_expires_at,
      LEAST(p_idle_expires_at, v_session.absolute_expires_at);
  ELSE
    UPDATE auth.sessions AS current_session SET
      last_seen_at = statement_timestamp(),
      idle_expires_at = LEAST(p_idle_expires_at, current_session.absolute_expires_at),
      updated_at = statement_timestamp()
    WHERE current_session.id = v_session.id;
    RETURN QUERY SELECT v_session.id, false, v_session.absolute_expires_at,
      LEAST(p_idle_expires_at, v_session.absolute_expires_at);
  END IF;
END
$function$;

COMMENT ON FUNCTION security_api.touch_or_rotate_session(bytea, bytea, timestamptz, timestamptz) IS
  'Touches a valid session or rotates an old session without ambiguous output-variable column references.';
