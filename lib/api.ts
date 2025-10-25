/**
 * API Configuration
 * Handles different API URLs for development and production
 */

export const getApiUrl = () => {
  // In production, use the environment variable
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  // In development, use localhost
  return "http://localhost:8000";
};

export const API_URL = getApiUrl();
