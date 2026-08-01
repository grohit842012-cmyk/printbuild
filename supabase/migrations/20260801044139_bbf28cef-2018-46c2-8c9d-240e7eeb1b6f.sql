-- 1) Bookings: replace racy self-referential-subquery WITH CHECK with a trigger guard
DROP POLICY IF EXISTS "Users update own booking notes" ON public.bookings;

CREATE POLICY "Users update own bookings"
ON public.bookings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.guard_booking_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  NEW.status := OLD.status;
  NEW.internal_notes := OLD.internal_notes;
  NEW.user_id := OLD.user_id;
  NEW.design_id := OLD.design_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_booking_protected_columns ON public.bookings;
CREATE TRIGGER guard_booking_protected_columns
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_protected_columns();

-- 2) design-renders: remove anonymous/public read, scope to owner folder or admin
DROP POLICY IF EXISTS "Public read of design renders" ON storage.objects;

CREATE POLICY "Owners and admins read design renders"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'design-renders'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);
