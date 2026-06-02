
-- 1. Restrict bookings UPDATE to safe columns only (customer-facing fields).
DROP POLICY IF EXISTS "Users update own booking notes" ON public.bookings;

CREATE POLICY "Users update own booking notes"
ON public.bookings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  -- Users cannot change immutable / admin-controlled fields
  AND status = (SELECT status FROM public.bookings b WHERE b.id = bookings.id)
  AND internal_notes IS NOT DISTINCT FROM (SELECT internal_notes FROM public.bookings b WHERE b.id = bookings.id)
  AND user_id = (SELECT user_id FROM public.bookings b WHERE b.id = bookings.id)
  AND design_id = (SELECT design_id FROM public.bookings b WHERE b.id = bookings.id)
);

-- 2. Add DELETE policy for stl-bundles storage (admin-only).
CREATE POLICY "Admins delete stl bundle files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'stl-bundles' AND public.has_role(auth.uid(), 'admin'));

-- 3. Tighten stl-bundles SELECT to verify ownership via bookings/stl_bundles join
--    (replacing folder-name based policy if present).
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (policyname ILIKE '%stl%' OR policyname ILIKE '%bundle%')
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Users view own stl bundle files via ownership"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'stl-bundles'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.stl_bundles sb
      JOIN public.bookings b ON b.id = sb.booking_id
      WHERE sb.storage_path = storage.objects.name
        AND b.user_id = auth.uid()
    )
  )
);

-- 4. Restrict user_roles policies to authenticated role only.
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;

CREATE POLICY "Admins manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 5. Lock down has_role SECURITY DEFINER: only allow authenticated to execute.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
