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

/**
 * Utility function to handle API calls with graceful error handling
 * Returns null when API is not available (common in deployment)
 */
export const fetchWithFallback = async (url: string, options?: RequestInit): Promise<any> => {
  try {
    const response = await fetch(url, options);
    if (response.ok) {
      return await response.json();
    } else {
      console.log(`[API] Endpoint not available (${response.status}): ${url}`);
      return null;
    }
  } catch (error) {
    console.log(`[API] Backend not available: ${url}`, error);
    return null;
  }
};
