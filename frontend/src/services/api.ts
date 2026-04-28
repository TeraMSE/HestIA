import axios, { AxiosError, AxiosInstance } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api: AxiosInstance = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest && !("_retry" in originalRequest)) {
      const _retry = originalRequest as any;
      _retry._retry = true;

      try {
        const refreshToken = localStorage.getItem("refresh_token");
        if (!refreshToken) throw new Error("No refresh token");

        const response = await axios.post(`${API_BASE_URL}/api/v1/auth/jwt/refresh/`, {
          refresh: refreshToken,
        });

        localStorage.setItem("access_token", response.data.access);
        if (response.data.refresh) {
          localStorage.setItem("refresh_token", response.data.refresh);
        }

        api.defaults.headers.common.Authorization = `Bearer ${response.data.access}`;
        originalRequest.headers.Authorization = `Bearer ${response.data.access}`;

        return api(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("user");
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
