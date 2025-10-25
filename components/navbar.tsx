"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

import { Button } from "./ui/button";

export const Navbar = () => {
  const pathname = usePathname();
  const isNewUserPage = pathname === "/new-user";

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
            Powered by <span className="text-nvidia-green">NVIDIA</span>, <span className="text-blue-500">Toolhouse</span>, <span className="text-nvidia-cyan">ElevenLabs</span> & <span className="text-yellow-500">Google Cloud Platform</span>.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          asChild
          className="rounded-full border-2 border-nvidia-green bg-nvidia-green px-4 py-2 text-sm font-semibold text-black transition hover:bg-nvidia-green/80"
        >
          <Link href={isNewUserPage ? "/" : "/new-user"}>
            {isNewUserPage ? "Back to Dispatcher" : "Report Traffic Signal"}
          </Link>
        </Button>
      </div>
    </div>
  );
};
