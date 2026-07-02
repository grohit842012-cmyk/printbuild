
CREATE POLICY "Public read of design renders"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'design-renders');
