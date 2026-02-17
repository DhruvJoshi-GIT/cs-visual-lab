"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";

export default function Navbar() {
  const pathname = usePathname();
  const isModule = pathname.startsWith("/modules/");

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#1e1e2e]/50 bg-[#0a0a0f]/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            {isModule && (
              <Link
                href="/"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1e1e2e] hover:bg-[#2a2a3e] text-[#a1a1aa] hover:text-white transition-all duration-200"
              >
                <ArrowLeft size={16} />
              </Link>
            )}
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#06b6d4] shadow-lg shadow-[#6366f1]/20">
                <Sparkles size={16} className="text-white" />
              </div>
              <span className="text-base font-semibold tracking-tight">
                <span className="text-white">CS</span>
                <span className="text-[#6366f1]"> Visual</span>
                <span className="text-[#71717a]"> Lab</span>
              </span>
            </Link>
          </div>

          <div className="hidden sm:flex items-center gap-1">
            <Link
              href="/"
              className={`px-3 py-1.5 rounded-lg text-sm transition-all duration-200 ${
                pathname === "/"
                  ? "text-white bg-[#1e1e2e]"
                  : "text-[#71717a] hover:text-white hover:bg-[#1e1e2e]/50"
              }`}
            >
              Explore
            </Link>
            <span className="px-3 py-1.5 rounded-lg text-sm text-[#71717a]/50 cursor-default">
              Learning Paths
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
              <span className="text-xs text-[#10b981] font-medium">5 modules live</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
