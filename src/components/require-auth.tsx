import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

/** Small wrapper that redirects to /auth if not signed in. */
export function RequireAuth({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const { user, isAdmin, loading, roles } = useAuth();
  const navigate = useNavigate();
  // Roles are fetched async after the user is set; wait for them before deciding.
  const rolesReady = !user || roles.length > 0 || !requireAdmin;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ to: "/auth" });
      return;
    }
    if (requireAdmin && rolesReady && !isAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, isAdmin, loading, requireAdmin, rolesReady, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return null;
  if (requireAdmin && !isAdmin) return null;
  return <>{children}</>;
}
