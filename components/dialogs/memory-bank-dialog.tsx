"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { API_URL, fetchWithFallback } from "@/lib/api";
import { RefreshCw, Clock, User, MapPin } from "lucide-react";
import { EventsTimeline } from "@/components/ui/simple-chart";

interface MemoryEvent {
  id: string;
  prompt: string;
  timestamp: string;
  filter_reason: string;
  metadata: string;
}

interface MemoryBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemoryBankDialog({ open, onOpenChange }: MemoryBankDialogProps) {
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    last24h: 0,
    avgPerHour: 0,
  });

  const fetchMemoryEvents = async () => {
    setLoading(true);
    try {
      const data = await fetchWithFallback(`${API_URL}/api/context-bus/filtered?count=50`);

      if (data && data.events) {
        setEvents(data.events || []);

        // Calculate stats
        const now = new Date();
        const last24h = data.events.filter((event: MemoryEvent) => {
          const eventTime = new Date(event.timestamp);
          return now.getTime() - eventTime.getTime() < 24 * 60 * 60 * 1000;
        }).length;

        setStats({
          total: data.events.length,
          last24h,
          avgPerHour: last24h / 24,
        });
      } else {
        // API not available, set empty state
        setEvents([]);
        setStats({ total: 0, last24h: 0, avgPerHour: 0 });
      }
    } catch (error) {
      console.error("Error fetching memory events:", error);
      setEvents([]);
      setStats({ total: 0, last24h: 0, avgPerHour: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchMemoryEvents();
    }
  }, [open]);

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

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case "high": return "bg-red-500/10 text-red-400 border-red-500/20";
      case "medium": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
      case "low": return "bg-green-500/10 text-green-400 border-green-500/20";
      default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] bg-black border-nvidia-purple/20">
        <DialogHeader>
          <DialogTitle className="text-nvidia-purple flex items-center gap-2">
            <div className="w-3 h-3 bg-nvidia-purple rounded-full animate-pulse" />
            Memory Bank - High-Priority Traffic Events
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-nvidia-purple/5 border border-nvidia-purple/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-nvidia-purple">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Events</div>
            </div>
            <div className="bg-nvidia-purple/5 border border-nvidia-purple/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-nvidia-purple">{stats.last24h}</div>
              <div className="text-xs text-muted-foreground">Last 24 Hours</div>
            </div>
            <div className="bg-nvidia-purple/5 border border-nvidia-purple/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-nvidia-purple">{stats.avgPerHour.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Avg/Hour</div>
            </div>
          </div>

          {/* Timeline Chart */}
          <EventsTimeline
            events={events.map(e => ({ timestamp: e.timestamp, count: 1 }))}
            className="mb-4"
          />

          {/* Refresh Button */}
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Recent Events</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchMemoryEvents}
              disabled={loading}
              className="border-nvidia-purple/20 hover:bg-nvidia-purple/10"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Events List */}
          <ScrollArea className="h-96">
            <div className="space-y-3">
              {events.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="w-16 h-16 mx-auto mb-4 bg-nvidia-purple/10 rounded-full flex items-center justify-center">
                    <Clock className="w-8 h-8 text-nvidia-purple" />
                  </div>
                  <p>No high-priority traffic events in memory bank</p>
                  <p className="text-sm">Events will appear here when traffic content passes AI evaluation</p>
                </div>
              ) : (
                events.map((event) => {
                  const metadata = parseMetadata(event.metadata);
                  return (
                    <div
                      key={event.id}
                      className="bg-nvidia-purple/5 border border-nvidia-purple/20 rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-white font-medium leading-relaxed">
                            {event.prompt}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 items-end">
                          {metadata.severity && (
                            <Badge className={getSeverityColor(metadata.severity)}>
                              {metadata.severity}
                            </Badge>
                          )}
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
                        {metadata.latitude && metadata.longitude && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {parseFloat(metadata.latitude).toFixed(4)}, {parseFloat(metadata.longitude).toFixed(4)}
                          </div>
                        )}
                        <div className="text-nvidia-purple">
                          ID: {event.id}
                        </div>
                      </div>

                      {event.filter_reason && (
                        <div className="text-xs text-muted-foreground bg-black/20 rounded p-2">
                          <strong>Reason:</strong> {event.filter_reason}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}