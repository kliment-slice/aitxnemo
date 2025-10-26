"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { API_URL } from "@/lib/api";
import { RefreshCw, Clock, User, Shield, X, Trash2 } from "lucide-react";
import { EventsTimeline } from "@/components/ui/simple-chart";
import { toast } from "sonner";

interface FilteredEvent {
  id: string;
  prompt: string;
  timestamp: string;
  reject_reason: string;
  metadata: string;
}

interface FilteredEventsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilteredEventsDialog({ open, onOpenChange }: FilteredEventsDialogProps) {
  const [events, setEvents] = useState<FilteredEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    last24h: 0,
    rejectionRate: 0,
  });

  const fetchFilteredEvents = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/context-bus/rejected?count=50`);
      const data = await response.json();
      setEvents(data.events || []);

      // Calculate stats
      const now = new Date();
      const last24h = data.events.filter((event: FilteredEvent) => {
        const eventTime = new Date(event.timestamp);
        return now.getTime() - eventTime.getTime() < 24 * 60 * 60 * 1000;
      }).length;

      // Get total events to calculate rejection rate
      const statsResponse = await fetch(`${API_URL}/api/context-bus/stats`);
      const statsData = await statsResponse.json();
      const totalEvents = statsData.total_events || 1; // Avoid division by zero
      const rejectionRate = ((data.events.length / totalEvents) * 100);

      setStats({
        total: data.events.length,
        last24h,
        rejectionRate,
      });
    } catch (error) {
      console.error("Error fetching filtered events:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchFilteredEvents();
    }
  }, [open]);

  const handleDeleteAllEvents = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`${API_URL}/api/context-bus/rejected/all`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete events");
      }

      const result = await response.json();
      toast.success(`Successfully deleted ${result.deleted_count} rejected events`);

      // Refresh the events list
      await fetchFilteredEvents();
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error("Error deleting all events:", error);
      toast.error("Failed to delete events");
    } finally {
      setDeleting(false);
    }
  };

  const parseMetadata = (metadataStr: string) => {
    try {
      return JSON.parse(metadataStr);
    } catch {
      return {};
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getRejectionTypeColor = (reason: string) => {
    if (reason?.toLowerCase().includes("non-traffic")) {
      return "bg-red-500/10 text-red-400 border-red-500/20";
    } else if (reason?.toLowerCase().includes("spam")) {
      return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    } else if (reason?.toLowerCase().includes("keyword")) {
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    }
    return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  };

  const getShortReason = (reason: string) => {
    if (reason?.includes("No traffic keywords")) return "No Keywords";
    if (reason?.includes("non-traffic")) return "Non-Traffic";
    if (reason?.includes("spam")) return "Spam";
    return "Filtered";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] bg-black border-red-500/20">
        <DialogHeader>
          <DialogTitle className="text-red-400 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Filtered Events - Rejected Content
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Rejected</div>
            </div>
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.last24h}</div>
              <div className="text-xs text-muted-foreground">Last 24 Hours</div>
            </div>
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.rejectionRate.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">Rejection Rate</div>
            </div>
          </div>

          {/* Timeline Chart */}
          <EventsTimeline
            events={events.map(e => ({ timestamp: e.timestamp, count: 1 }))}
            className="mb-4"
            color="bg-red-400"
          />

          {/* Actions */}
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Rejected Events</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchFilteredEvents}
                disabled={loading}
                className="border-red-500/20 hover:bg-red-500/10"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              {events.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={loading || deleting}
                  className="border-red-500/40 hover:bg-red-500/20 text-red-400"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete All
                </Button>
              )}
            </div>
          </div>

          {/* Events List */}
          <ScrollArea className="h-96">
            <div className="space-y-3">
              {events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="w-16 h-16 mx-auto mb-4 bg-green-500/10 rounded-full flex items-center justify-center">
                    <Shield className="w-8 h-8 text-green-400" />
                  </div>
                  <p>No content has been filtered yet</p>
                  <p className="text-sm">Rejected non-traffic content will appear here</p>
                </div>
              ) : (
                events.map((event) => {
                  const metadata = parseMetadata(event.metadata);
                  return (
                    <div
                      key={event.id}
                      className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-white font-medium leading-relaxed">
                            {event.prompt}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 items-end">
                          <Badge className={getRejectionTypeColor(event.reject_reason)}>
                            <X className="w-3 h-3 mr-1" />
                            {getShortReason(event.reject_reason)}
                          </Badge>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTimestamp(event.timestamp)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {metadata.display_name && (
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {metadata.display_name}
                          </div>
                        )}
                        <div className="text-red-400">
                          ID: {event.id}
                        </div>
                      </div>

                      {event.reject_reason && (
                        <div className="text-xs text-muted-foreground bg-black/20 rounded p-2">
                          <strong>Rejection Reason:</strong> {event.reject_reason}
                        </div>
                      )}

                      {/* Security Note */}
                      <div className="text-xs text-green-400 bg-green-500/5 border border-green-500/20 rounded p-2">
                        ✓ Content successfully filtered by Nemotron security layer
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md bg-black border-red-500/20">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Delete All Rejected Events
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-white">
              Are you sure you want to delete all <span className="font-bold text-red-400">{events.length}</span> rejected events?
            </p>

            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm text-red-300">
                ⚠️ This action cannot be undone. All filtered/rejected content will be permanently removed from the system.
              </p>
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="border-gray-500/20 hover:bg-gray-500/10"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAllEvents}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete All
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}