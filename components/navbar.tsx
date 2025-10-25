"use client";

import { Github } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

import { Button } from "./ui/button";

export const Navbar = () => {
  return (
    <div className="p-4 flex flex-row gap-4 justify-between items-center border-b-2 border-nvidia-green bg-gradient-to-r from-black via-black/95 to-nvidia-green/10">
      <div className="flex items-center gap-3">
        <Image
          src="/NCH.png"
          alt="NeMo Context Highway"
          width={48}
          height={48}
          className="rounded-full"
        />
        <div className="flex flex-col">
          <h1 className="text-lg font-bold text-nvidia-green">NeMo Context Highway</h1>
          <p className="text-xs text-muted-foreground">
            Powered by <span className="text-nvidia-green">NVIDIA</span> & <span className="text-nvidia-cyan">ElevenLabs</span>
          </p>
        </div>
      </div>
    </div>
  );
};
