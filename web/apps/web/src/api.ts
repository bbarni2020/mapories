import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const CSRF_KEY = "mapories_csrf";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("mapories_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const csrf = localStorage.getItem(CSRF_KEY);
  if (csrf) {
    config.headers["x-csrf-token"] = csrf;
  }

  return config;
});

let isRefreshing = false;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest?._retry &&
      !String(originalRequest?.url || "").includes("/auth/refresh")
    ) {
      originalRequest._retry = true;

      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const csrf = localStorage.getItem(CSRF_KEY);
          const response = await api.post("/auth/refresh", {}, {
            headers: csrf ? { "x-csrf-token": csrf } : {},
          });

          if (response.data?.accessToken) {
            setAuthToken(response.data.accessToken);
          }

          if (response.data?.csrfToken) {
            setCsrfToken(response.data.csrfToken);
          }
        } catch {
          setAuthToken(null);
          setCsrfToken(null);
        } finally {
          isRefreshing = false;
        }
      }

      return api(originalRequest);
    }

    return Promise.reject(error);
  },
);

export const setAuthToken = (token: string | null) => {
  if (!token) {
    localStorage.removeItem("mapories_token");
    return;
  }

  localStorage.setItem("mapories_token", token);
};

export const setCsrfToken = (token: string | null) => {
  if (!token) {
    localStorage.removeItem(CSRF_KEY);
    return;
  }

  localStorage.setItem(CSRF_KEY, token);
};
