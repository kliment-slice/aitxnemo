"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Flag, Archive, X, TrafficCone } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { API_URL, fetchWithFallback } from "@/lib/api";
import { TrafficMap } from "./traffic-map";
import { Button } from "./ui/button";

interface ContextEvent {
  id: string;
  prompt: string;
  timestamp: string;
  filtered?: string;
  metadata?: string | {
    latitude?: string;
    longitude?: string;
    [key: string]: any;
  };
}

export const Overview = () => {
  const [events, setEvents] = useState<ContextEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<ContextEvent | null>(null);
  const [updateReport, setUpdateReport] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch context bus data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch filtered events with fallback
        const eventsData = await fetchWithFallback(`${API_URL}/api/context-bus/filtered?count=5`);

        if (eventsData?.events && eventsData.events.length > 0) {
          console.log('[Overview] Fetched events:', eventsData.events);
          setEvents(eventsData.events);
        } else {
          console.log('[Overview] No events available or API not accessible');
          setEvents([]);
        }
      } catch (error) {
        console.error("Error fetching context bus data:", error);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Poll for updates every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleFlagEvent = (event: ContextEvent) => {
    setSelectedEvent(event);
    setUpdateReport("");
  };

  const handleCloseModal = () => {
    setSelectedEvent(null);
    setUpdateReport("");
    setIsSubmitting(false);
  };

  const handleSubmitUpdate = async () => {
    if (!updateReport.trim() || !selectedEvent) {
      toast.error("Please provide an update report");
      return;
    }

    try {
      setIsSubmitting(true);

      const response = await fetch(`${API_URL}/api/context-bus/flag`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_id: selectedEvent.id,
          update: updateReport,
          original_prompt: selectedEvent.prompt,
        }),
      });

      if (!response.ok) {
        if (response.status === 405 || response.status === 404) {
          throw new Error("Backend API not available. Please try again later.");
        }
        throw new Error("Failed to submit update");
      }

      const result = await response.json();

      // Show enhanced success message with context
      if (result.enhanced_summary) {
        toast.success("Update with context generated successfully!", {
          description: `Original: "${result.original_reference}"`
        });
      } else {
        toast.success("Update reported successfully!");
      }

      handleCloseModal();

      // Refresh events to show the new update
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("Failed to submit update:", error);
      toast.error("Failed to submit update");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveEvent = async () => {
    if (!selectedEvent) return;

    try {
      setIsSubmitting(true);

      const response = await fetch(`${API_URL}/api/context-bus/archive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_id: selectedEvent.id,
        }),
      });

      if (!response.ok) {
        if (response.status === 405 || response.status === 404) {
          throw new Error("Backend API not available. Please try again later.");
        }
        throw new Error("Failed to archive event");
      }

      // Remove from local state
      setEvents(events.filter(e => e.id !== selectedEvent.id));
      toast.success("Event archived successfully!");
      handleCloseModal();
    } catch (error) {
      console.error("Failed to archive event:", error);
      toast.error("Failed to archive event");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      key="overview"
      className="w-full h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: 0.3 }}
    >
      {/* Split View: Map + Event Stream */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-0">
        {/* Live Traffic Map */}
        <div className="relative border-r-2 border-nvidia-green/30">
          <TrafficMap className="h-full min-h-[500px]" />
          <div className="absolute top-4 left-4 bg-black/80 backdrop-blur border border-nvidia-green/30 rounded-xl px-4 py-2 shadow-[0_0_20px_rgba(0,255,170,0.2)]">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 bg-nvidia-green rounded-full animate-pulse"></div>
              <span className="text-xs font-semibold text-nvidia-green">LIVE TRAFFIC MAP</span>
            </div>
          </div>
        </div>

        {/* Event Stream Visualization */}
        <div className="flex-1 overflow-hidden p-6">
        <div className="max-w-7xl mx-auto">
          {/* Event List */}
          <div className="space-y-2">
            <div className="text-md text-muted-foreground mb-2 flex items-center gap-2">
              <TrafficCone size={48} className="text-nvidia-green" />
              Recent Context Events {loading && <span className="animate-pulse">(loading...)</span>}
            </div>
            {events.length === 0 && !loading && (
              <div className="text-center p-8 text-muted-foreground">
                No signals yet. Use the Contribute Context portal to populate the Context Highway.
              </div>
            )}
            {events.map((event, index) => {
              // Calculate relative time from ISO timestamp
              const getRelativeTime = (isoTime: string) => {
                try {
                  const eventTime = new Date(isoTime);
                  const now = new Date();
                  const diffMs = now.getTime() - eventTime.getTime();
                  const diffMins = Math.floor(diffMs / 60000);
                  if (diffMins < 1) return "just now";
                  if (diffMins < 60) return `${diffMins}m ago`;
                  const diffHours = Math.floor(diffMins / 60);
                  if (diffHours < 24) return `${diffHours}h ago`;
                  return `${Math.floor(diffHours / 24)}d ago`;
                } catch {
                  return isoTime;
                }
              };

              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="group flex items-center justify-between p-4 bg-black/40 border border-nvidia-green/20 hover:border-nvidia-green/50 rounded-lg transition-all hover:bg-nvidia-green/5"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-2 h-2 bg-nvidia-green rounded-full group-hover:animate-pulse"></div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">{event.prompt}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                        <span>{getRelativeTime(event.timestamp)}</span>
                        {event.filtered === "true" && (
                          <span className="px-2 py-0.5 bg-nvidia-cyan/20 text-nvidia-cyan rounded text-xs">
                            Filtered
                          </span>
                        )}
                        {(() => {
                          // Check if this is an update event
                          try {
                            const metadata = typeof event.metadata === 'string'
                              ? JSON.parse(event.metadata)
                              : event.metadata;

                            if (metadata && metadata.type === 'update') {
                              return (
                                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-500 rounded text-xs flex items-center gap-1">
                                  🔄 Update
                                </span>
                              );
                            }
                          } catch (e) {
                            // Ignore parsing errors
                          }
                          return null;
                        })()}
                        {(() => {
                          // Check for coordinates in metadata
                          try {
                            const metadata = typeof event.metadata === 'string'
                              ? JSON.parse(event.metadata)
                              : event.metadata;

                            console.log('[Overview] Event metadata:', event.id, metadata);

                            if (metadata && metadata.latitude && metadata.longitude) {
                              const lat = parseFloat(metadata.latitude);
                              const lng = parseFloat(metadata.longitude);
                              console.log('[Overview] Displaying coordinates:', lat, lng);
                              return (
                                <span className="px-2 py-0.5 bg-nvidia-green/20 text-nvidia-green rounded text-xs font-mono">
                                  📍 {lat.toFixed(6)}, {lng.toFixed(6)}
                                </span>
                              );
                            }
                          } catch (e) {
                            console.error('[Overview] Error parsing metadata:', e);
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleFlagEvent(event)}
                      className="p-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:border-amber-500/50 transition-all"
                      title="Flag for update"
                    >
                      <Flag size={14} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Start Prompt */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="mt-8 text-center"
          >
          </motion.div>
        </div>
        </div>
      </div>

      {/* Flag/Archive Modal */}
      <AnimatePresence>
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl mx-4 bg-gradient-to-br from-black via-nvidia-green/5 to-black border-2 border-nvidia-green/30 rounded-2xl p-6 shadow-[0_0_50px_rgba(0,255,170,0.3)]"
            >
              {/* Close button */}
              <button
                onClick={handleCloseModal}
                className="absolute top-4 right-4 p-2 rounded-lg border border-nvidia-green/30 bg-black/60 text-muted-foreground hover:text-nvidia-green hover:border-nvidia-green/50 transition-all"
              >
                <X size={20} />
              </button>

              {/* Header */}
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
                    <Flag className="text-amber-500" size={20} />
                  </div>
                  <h2 className="text-xl font-bold text-nvidia-green">Flag Event for Update</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Report an update or archive this event from the context bus
                </p>
              </div>

              {/* Original Event */}
              <div className="mb-6 p-4 bg-black/60 border border-nvidia-green/20 rounded-lg">
                <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                  <span>Original Event:</span>
                  <span className="px-2 py-0.5 bg-nvidia-green/20 text-nvidia-green rounded text-xs">
                    Will be referenced in update
                  </span>
                </div>
                <div className="text-sm text-foreground bg-black/40 p-3 rounded border-l-4 border-nvidia-green/50">
                  "{selectedEvent.prompt}"
                </div>
                <div className="text-xs text-muted-foreground mt-2 flex items-center justify-between">
                  <span>{new Date(selectedEvent.timestamp).toLocaleString()}</span>
                  <span className="text-nvidia-cyan">Event ID: {selectedEvent.id.slice(-8)}</span>
                </div>
              </div>

              {/* Update Report Textarea */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-nvidia-green mb-2">
                  Update Report
                </label>
                <textarea
                  value={updateReport}
                  onChange={(e) => setUpdateReport(e.target.value)}
                  placeholder="Describe the current status, resolution, or new information about this incident. The system will automatically reference the original event when creating the update."
                  className="w-full min-h-[120px] resize-none rounded-lg border-2 border-nvidia-green/30 bg-black/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground shadow-inner backdrop-blur transition focus:border-nvidia-green focus:outline-none focus:ring-2 focus:ring-nvidia-green/40"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-4">
                <Button
                  onClick={handleArchiveEvent}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-lg border-2 border-red-500/30 bg-red-500/10 px-6 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/20 hover:border-red-500/50 transition-all disabled:opacity-50"
                >
                  <Archive size={16} />
                  Archive Event
                </Button>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleCloseModal}
                    disabled={isSubmitting}
                    className="rounded-lg border-2 border-nvidia-green/30 bg-black/60 px-6 py-2 text-sm font-semibold text-muted-foreground hover:text-nvidia-green hover:border-nvidia-green/50 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitUpdate}
                    disabled={isSubmitting || !updateReport.trim()}
                    className="rounded-lg border-2 border-nvidia-green bg-nvidia-green px-6 py-2 text-sm font-semibold text-black hover:bg-nvidia-green/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? "Submitting..." : "Submit Update"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
