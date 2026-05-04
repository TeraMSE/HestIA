import { create } from "zustand";
import api from "@/services/api";

export type UserRole = "renter" | "buyer" | "landlord";

export interface User {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  role: UserRole;
  verified_email: boolean;
  created_at: string;
  // Living preference fields (optional — set from Settings page)
  bio?: string;
  noise_tolerance?: number | null;
  cleanliness?: number | null;
  thermal_sensitivity?: number | null;
  smoker?: boolean | null;
  daily_schedule?: "early_bird" | "flexible" | "night_owl" | "";
}

interface AuthStore {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  signup: (email: string, password: string, firstName: string, lastName: string, role: UserRole) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<boolean>;
  initializeAuth: () => void;
}

// Pre-populate user synchronously from localStorage so it's available on first render
function loadStoredUser(): User | null {
  try {
    const stored = localStorage.getItem("user");
    if (!stored) return null;
    const user = JSON.parse(stored);
    // Reject stale objects that predate the role field
    if (!user?.role) return null;
    return user;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: loadStoredUser(), // ← synchronous: available on first render, no race condition
  isLoading: false,
  error: null,

  initializeAuth: () => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        set({ user: JSON.parse(storedUser) });
      } catch {
        localStorage.removeItem("user");
      }
    }
  },

  signup: async (email: string, password: string, firstName: string, lastName: string, role: UserRole) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post("/auth/users/", {
        email,
        password,
        re_password: password,   // Djoser expects re_password, not password2
        first_name: firstName,
        last_name: lastName,
        role,
      });

      // Auto-login to get JWT tokens (Djoser signup response doesn't include tokens)
      const loginRes = await api.post("/auth/jwt/create/", { email, password });
      localStorage.setItem("access_token", loginRes.data.access);
      localStorage.setItem("refresh_token", loginRes.data.refresh);

      // Fetch the full user profile (includes role from our custom serializer)
      const meRes = await api.get("/auth/users/me/");
      const userData: User = meRes.data;
      localStorage.setItem("user", JSON.stringify(userData));
      set({ user: userData, isLoading: false });
    } catch (error: any) {
      // Djoser returns field-level errors as { field: ["msg"] } — flatten them
      const data = error.response?.data;
      let errorMsg = "Signup failed";
      if (data) {
        if (typeof data === "object") {
          const msgs = Object.values(data).flat();
          errorMsg = (msgs[0] as string) || errorMsg;
        } else if (typeof data === "string") {
          errorMsg = data;
        }
      }
      set({ error: errorMsg, isLoading: false });
      throw error;
    }
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post("/auth/jwt/create/", {
        email,
        password,
      });

      localStorage.setItem("access_token", response.data.access);
      localStorage.setItem("refresh_token", response.data.refresh);

      const userResponse = await api.get("/auth/users/me/");
      const userData: User = userResponse.data;
      localStorage.setItem("user", JSON.stringify(userData));
      set({ user: userData, isLoading: false });
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || "Login failed";
      set({ error: errorMsg, isLoading: false });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    set({ user: null, error: null });
  },

  refreshToken: async () => {
    try {
      const refresh = localStorage.getItem("refresh_token");
      if (!refresh) return false;

      const response = await api.post("/auth/jwt/refresh/", { refresh });
      localStorage.setItem("access_token", response.data.access);
      if (response.data.refresh) {
        localStorage.setItem("refresh_token", response.data.refresh);
      }
      return true;
    } catch {
      set({ user: null });
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("user");
      return false;
    }
  },
}));
