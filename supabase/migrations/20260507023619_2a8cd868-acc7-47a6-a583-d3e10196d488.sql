DROP POLICY IF EXISTS "Authenticated users view all reviews" ON public.reviews;

CREATE POLICY "Users view own reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins view all reviews"
ON public.reviews
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));