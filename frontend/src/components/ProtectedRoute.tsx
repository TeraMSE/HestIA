import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/shared/store/useAuthStore";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

function isTokenExpiredOrStale(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // Refresh if < 2 minutes remaining
    return payload.exp * 1000 - Date.now() < 120_000;
  } catch {
    return true;
  }
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, refreshToken } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    if (!user) {
      setReady(true);
      return;
    }

    const token = localStorage.getItem("access_token");
    if (!token || isTokenExpiredOrStale(token)) {
      refreshToken().then((ok) => {
        setValid(ok);
        setReady(true);
      });
    } else {
      setValid(true);
      setReady(true);
    }
  }, []);

  if (!ready) return null;
  if (!user || !valid) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
