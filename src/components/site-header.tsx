import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

export function SiteHeader() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <Compass className="h-5 w-5 text-accent group-hover:rotate-45 transition-transform" />
          <span className="font-display text-xl tracking-tight">Vaastu Studio</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4 text-sm">
          {user ? (
            <>
              <Link to="/designs" className="hidden sm:inline text-muted-foreground hover:text-foreground">
                My designs
              </Link>
              {isAdmin && (
                <Link to="/admin" className="text-muted-foreground hover:text-foreground">
                  Admin
                </Link>
              )}
              <Button asChild size="sm" variant="default">
                <Link to="/design/new">Start designing</Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await signOut();
                  void navigate({ to: "/" });
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link to="/auth" className="text-muted-foreground hover:text-foreground">
                Sign in
              </Link>
              <Button asChild size="sm">
                <Link to="/auth">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
