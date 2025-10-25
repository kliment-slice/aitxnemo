"use client";

import { useEffect, useState, useCallback } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MapPin, Navigation2, AlertCircle } from "lucide-react";

interface TrafficMapProps {
  className?: string;
}

export function TrafficMap({ className }: TrafficMapProps) {
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    // Get user's current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setIsLocating(false);
        },
        (error) => {
          console.error("Error getting location:", error);
          setLocationError(error.message);
          setIsLocating(false);
          // Default to San Francisco if location fails
          setUserLocation({
            lat: 37.7749,
            lng: -122.4194,
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    } else {
      setLocationError("Geolocation is not supported by this browser.");
      setIsLocating(false);
      // Default to San Francisco
      setUserLocation({
        lat: 37.7749,
        lng: -122.4194,
      });
    }
  }, []);

  const handleRecenter = useCallback(() => {
    if (navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setIsLocating(false);
        },
        (error) => {
          console.error("Error getting location:", error);
          setIsLocating(false);
        }
      );
    }
  }, []);

  if (!userLocation) {
    return (
      <div
        className={`flex items-center justify-center bg-black/60 backdrop-blur ${className}`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-nvidia-green border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {isLocating ? "Locating..." : "Loading map..."}
          </p>
        </div>
      </div>
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey || mapError) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-black via-nvidia-green/5 to-black backdrop-blur p-8 ${className}`}
      >
        <div className="relative w-full max-w-md aspect-square rounded-2xl border-2 border-nvidia-green/30 bg-black/60 overflow-hidden">
          {/* Placeholder Map Grid */}
          <div className="absolute inset-0 grid grid-cols-4 grid-rows-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="border border-nvidia-green/10"
                style={{
                  background: `radial-gradient(circle at ${Math.random() * 100}% ${Math.random() * 100}%, rgba(0, 255, 170, 0.05), transparent)`,
                }}
              />
            ))}
          </div>

          {/* Center marker */}
          {userLocation && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <div className="absolute h-16 w-16 animate-ping rounded-full bg-nvidia-green opacity-20" />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full border-4 border-nvidia-green bg-black shadow-[0_0_30px_rgba(0,255,170,0.6)]">
                  <MapPin className="h-6 w-6 text-nvidia-green" />
                </div>
              </div>
            </div>
          )}

          {/* Coordinates display */}
          {userLocation && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/90 backdrop-blur border border-nvidia-green/30 rounded-lg px-3 py-1.5 text-xs font-mono text-nvidia-green">
              {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-amber-400">
          <AlertCircle size={16} />
          <p className="text-sm">
            {mapError || "Enable Maps JavaScript API in Google Cloud Console"}
          </p>
        </div>

        <a
          href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-nvidia-cyan hover:underline"
        >
          Open Google Cloud Console →
        </a>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <APIProvider
        apiKey={apiKey}
        onError={(error) => {
          console.error("Google Maps API Error:", error);
          setMapError("Maps API not activated. Please enable it in Google Cloud Console.");
        }}
      >
        <Map
          defaultCenter={userLocation}
          center={userLocation}
          defaultZoom={14}
          mapId="nemo-context-highway-map"
          disableDefaultUI={false}
          gestureHandling="greedy"
          className="h-full w-full"
          mapTypeControl={true}
          streetViewControl={true}
          fullscreenControl={true}
          zoomControl={true}
          styles={[
            {
              featureType: "all",
              elementType: "geometry",
              stylers: [{ color: "#0a0a0a" }],
            },
            {
              featureType: "all",
              elementType: "labels.text.fill",
              stylers: [{ color: "#00ffaa" }],
            },
            {
              featureType: "all",
              elementType: "labels.text.stroke",
              stylers: [{ color: "#000000" }, { lightness: 13 }],
            },
            {
              featureType: "road",
              elementType: "geometry",
              stylers: [{ color: "#1a1a1a" }],
            },
            {
              featureType: "road",
              elementType: "geometry.stroke",
              stylers: [{ color: "#00ffaa" }, { lightness: -80 }],
            },
            {
              featureType: "road.highway",
              elementType: "geometry",
              stylers: [{ color: "#2a2a2a" }],
            },
            {
              featureType: "water",
              elementType: "geometry",
              stylers: [{ color: "#000000" }],
            },
            {
              featureType: "poi",
              elementType: "geometry",
              stylers: [{ color: "#1a1a1a" }],
            },
          ]}
        >
          <AdvancedMarker position={userLocation}>
            <div className="relative flex h-12 w-12 items-center justify-center">
              <div className="absolute h-12 w-12 animate-ping rounded-full bg-nvidia-green opacity-20" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full border-4 border-nvidia-green bg-black shadow-[0_0_20px_rgba(0,255,170,0.5)]">
                <MapPin className="h-5 w-5 text-nvidia-green" />
              </div>
            </div>
          </AdvancedMarker>
        </Map>
      </APIProvider>

      {/* Recenter button */}
      <button
        onClick={handleRecenter}
        disabled={isLocating}
        className="absolute bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full border-2 border-nvidia-cyan bg-black/80 shadow-[0_0_20px_rgba(0,229,255,0.3)] backdrop-blur transition hover:bg-nvidia-cyan/20 hover:scale-110 disabled:opacity-50"
        title="Recenter to current location"
      >
        <Navigation2 className="h-5 w-5 text-nvidia-cyan" />
      </button>

      {/* Location error toast */}
      {locationError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-xl border border-red-500/30 bg-black/90 px-4 py-2 text-xs text-red-400 backdrop-blur">
          {locationError}
        </div>
      )}
    </div>
  );
}
