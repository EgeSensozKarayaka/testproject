-- migrate:transaction true

CREATE FUNCTION security_api.update_current_user_profile(
  p_owner_id uuid,
  p_expected_resource_version bigint,
  p_display_name text
)
RETURNS TABLE (
  owner_id uuid,
  email_display text,
  display_name text,
  email_verified_at timestamptz,
  resource_version bigint,
  created_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  UPDATE auth.users AS user_row
  SET
    display_name = p_display_name,
    resource_version = user_row.resource_version + 1,
    updated_at = statement_timestamp()
  WHERE user_row.id = p_owner_id
    AND user_row.status = 'ACTIVE'
    AND user_row.resource_version = p_expected_resource_version
  RETURNING
    user_row.id,
    user_row.email_display::text,
    user_row.display_name::text,
    user_row.email_verified_at,
    user_row.resource_version,
    user_row.created_at
$function$;

CREATE FUNCTION security_api.upgrade_password_hash(
  p_owner_id uuid,
  p_expected_password_version integer,
  p_expected_password_hash text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE auth.password_credentials
  SET password_hash = p_password_hash
  WHERE owner_id = p_owner_id
    AND password_version = p_expected_password_version
    AND password_hash = p_expected_password_hash;
  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION security_api.update_current_user_profile(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.upgrade_password_hash(uuid, integer, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION security_api.update_current_user_profile(uuid, bigint, text) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.upgrade_password_hash(uuid, integer, text, text) TO site_monitor_api;

COMMENT ON FUNCTION security_api.update_current_user_profile(uuid, bigint, text) IS
  'Updates only the authenticated owner profile with optimistic concurrency; callers must resolve the owner from a valid session.';
COMMENT ON FUNCTION security_api.upgrade_password_hash(uuid, integer, text, text) IS
  'Rehashes a successfully verified credential without changing password version or invalidating sessions.';
