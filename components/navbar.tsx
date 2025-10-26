"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

import { Button } from "./ui/button";
import { API_URL } from "@/lib/api";
import { MemoryBankDialog } from "./dialogs/memory-bank-dialog";
import { FilteredEventsDialog } from "./dialogs/filtered-events-dialog";

export const Navbar = () => {
  const pathname = usePathname();
  const isNewUserPage = pathname === "/new-user";
  const [memoryEventsCount, setMemoryEventsCount] = useState(0);
  const [filteredEventsCount, setFilteredEventsCount] = useState(0);
  const [showMemoryDialog, setShowMemoryDialog] = useState(false);
  const [showFilteredDialog, setShowFilteredDialog] = useState(false);

  // Fetch context bus statistics
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const statsRes = await fetch(`${API_URL}/api/context-bus/stats`);
        const stats = await statsRes.json();
        setMemoryEventsCount(stats.memory_events || 0);  // High-priority traffic content
        setFilteredEventsCount(stats.filtered_events || 0);  // Rejected/non-traffic content
      } catch (error) {
        console.error("Error fetching context bus stats:", error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-3 md:p-4 border-b-2 border-nvidia-green bg-gradient-to-r from-black via-black/95 to-nvidia-green/10">
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 md:justify-between md:items-center">
        {/* Logo and Title */}
        <div className="flex items-center gap-2 md:gap-3">
          <div className="relative flex-shrink-0">
            <Image
              src="/NCH.png"
              alt="NeMo Context Highway"
              width={40}
              height={40}
              className="rounded-full md:w-12 md:h-12"
            />
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 md:w-3 md:h-3 bg-nvidia-green rounded-full animate-pulse border-2 border-black"></div>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base md:text-lg font-bold text-nvidia-green">NeMo Context Highway</h1>
              <span className="text-[9px] md:text-[10px] bg-nvidia-green/20 text-nvidia-green px-1.5 md:px-2 py-0.5 rounded-full font-semibold">LIVE</span>
            </div>
            <p className="text-[10px] md:text-xs text-muted-foreground line-clamp-2 md:line-clamp-none">
              Real-time agent for local traffic demonstrating <span className="text-nvidia-green">Nemotron-9b-v2</span>'s ability to mitigate context degradation.
            </p>
            <p className="hidden lg:block text-xs text-muted-foreground">
              Powered by <span className="text-nvidia-green">NVIDIA</span>, <span className="text-blue-500">Toolhouse</span>, <span className="text-nvidia-cyan">ElevenLabs</span> & <span className="text-yellow-500">Google Cloud Platform</span>.
            </p>
          </div>
        </div>

        {/* Context Bus Statistics & Action Button */}
        <div className="flex items-center justify-between md:justify-end gap-3 md:gap-4">
          {/* Context Bus Statistics */}
          <div className="flex items-center gap-2 md:gap-4">
            <div
              className="text-center px-2 md:px-3 py-1 bg-nvidia-purple/5 border border-nvidia-purple/20 rounded-lg cursor-pointer hover:bg-nvidia-purple/10 transition-colors"
              onClick={() => setShowMemoryDialog(true)}
            >
              <div className="text-sm md:text-lg font-bold text-nvidia-purple">{memoryEventsCount}</div>
              <div className="text-[8px] md:text-[10px] text-muted-foreground">Memory Bank</div>
            </div>
            <div
              className="text-center px-2 md:px-3 py-1 bg-red-500/5 border border-red-500/20 rounded-lg cursor-pointer hover:bg-red-500/10 transition-colors"
              onClick={() => setShowFilteredDialog(true)}
            >
              <div className="text-sm md:text-lg font-bold text-red-400">{filteredEventsCount}</div>
              <div className="text-[8px] md:text-[10px] text-muted-foreground">Filtered</div>
            </div>
          </div>

          {/* Action Button */}
          <Button
            asChild
            className="rounded-full border-2 border-nvidia-green bg-nvidia-green px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-semibold text-black transition hover:bg-nvidia-green/80 whitespace-nowrap"
          >
            <Link href={isNewUserPage ? "/" : "/new-user"}>
              {isNewUserPage ? "Dispatcher" : "Report Event"}
            </Link>
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      <MemoryBankDialog
        open={showMemoryDialog}
        onOpenChange={setShowMemoryDialog}
      />
      <FilteredEventsDialog
        open={showFilteredDialog}
        onOpenChange={setShowFilteredDialog}
      />
    </div>
  );
};
