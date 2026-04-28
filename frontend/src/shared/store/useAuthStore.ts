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

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
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
        password2: password,
        first_name: firstName,
        last_name: lastName,
        role,
      });

      const userData: User = response.data;
      localStorage.setItem("user", JSON.stringify(userData));
      set({ user: userData, isLoading: false });
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || "Signup failed";
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
