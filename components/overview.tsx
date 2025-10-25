"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Database, ArrowRight, Zap, Filter } from "lucide-react";
import { useState, useEffect } from "react";

interface ContextEvent {
  id: string;
  prompt: string;
  timestamp: string;
  filtered?: string;
}

export const Overview = () => {
  const [events, setEvents] = useState<ContextEvent[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [filteredEvents, setFilteredEvents] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch context bus data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch stats
        const statsRes = await fetch("http://localhost:8000/api/context-bus/stats");
        const stats = await statsRes.json();
        setTotalEvents(stats.total_events || 0);
        setFilteredEvents(stats.filtered_events || 0);

        // Fetch filtered events
        const eventsRes = await fetch("http://localhost:8000/api/context-bus/filtered?count=5");
        const eventsData = await eventsRes.json();

        if (eventsData.events && eventsData.events.length > 0) {
          setEvents(eventsData.events);
        }
      } catch (error) {
        console.error("Error fetching context bus data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Poll for updates every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      key="overview"
      className="w-full h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: 0.3 }}
    >
      {/* Context Bus Header */}
      <div className="border-b-2 border-nvidia-green/30 bg-gradient-to-r from-nvidia-green/5 to-transparent p-6">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Image
                src="/NCH.png"
                alt="NeMo Context Highway"
                width={64}
                height={64}
                className="rounded-full"
              />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-nvidia-green rounded-full animate-pulse border-2 border-black"></div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-nvidia-green flex items-center gap-2">
                Context Highway
                <span className="text-xs bg-nvidia-green/20 text-nvidia-green px-2 py-1 rounded-full">LIVE</span>
              </h1>
              <p className="text-sm text-muted-foreground">Redis Stream Event Bus • Memory Bank</p>
            </div>
          </div>
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-nvidia-green">{totalEvents}</div>
              <div className="text-xs text-muted-foreground">Total Events</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-nvidia-cyan">{filteredEvents}</div>
              <div className="text-xs text-muted-foreground">Filtered</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-nvidia-purple">{events.length}</div>
              <div className="text-xs text-muted-foreground">In Memory</div>
            </div>
          </div>
        </div>
      </div>

      {/* Event Stream Visualization */}
      <div className="flex-1 overflow-hidden p-6">
        <div className="max-w-7xl mx-auto">
          {/* Pipeline Flow */}
          <div className="mb-6 flex items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-2 px-4 py-2 bg-nvidia-green/10 border border-nvidia-green/30 rounded-lg">
              <Zap className="text-nvidia-green" size={16} />
              <span>Prompts</span>
            </div>
            <ArrowRight className="text-nvidia-green" size={20} />
            <div className="flex items-center gap-2 px-4 py-2 bg-nvidia-cyan/10 border border-nvidia-cyan/30 rounded-lg">
              <Filter className="text-nvidia-cyan" size={16} />
              <span>Filter</span>
            </div>
            <ArrowRight className="text-nvidia-green" size={20} />
            <div className="flex items-center gap-2 px-4 py-2 bg-nvidia-purple/10 border border-nvidia-purple/30 rounded-lg">
              <Database className="text-nvidia-purple" size={16} />
              <span>Redis Stream</span>
            </div>
          </div>

          {/* Event List */}
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
              <Database size={12} className="text-nvidia-green" />
              Recent Context Events {loading && <span className="animate-pulse">(loading...)</span>}
            </div>
            {events.length === 0 && !loading && (
              <div className="text-center p-8 text-muted-foreground">
                No events yet. Start a conversation to populate the Context Highway.
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
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                        <span>{getRelativeTime(event.timestamp)}</span>
                        {event.filtered === "true" && (
                          <span className="px-2 py-0.5 bg-nvidia-cyan/20 text-nvidia-cyan rounded text-xs">
                            Filtered
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="text-nvidia-green/50 group-hover:text-nvidia-green transition-colors" size={16} />
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
            <p className="text-sm text-muted-foreground">
              Start a conversation to add events to the Context Highway
            </p>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};
