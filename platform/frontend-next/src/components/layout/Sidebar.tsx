"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Beaker,
  Cog,
  GitGraph,
  History,
  LayoutDashboard,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/cn";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/topologia", label: "Topologia", icon: GitGraph },
  { href: "/experimentos", label: "Experimentos", icon: Beaker },
  { href: "/configuracoes", label: "Configurações", icon: Cog },
  { href: "/lab", label: "Lab", icon: Activity },
  { href: "/monitor", label: "Monitor", icon: Monitor },
  { href: "/historico", label: "Histórico", icon: History },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-30 h-screen w-16 border-r border-border-0/60 bg-bg-1/40">
      <div className="flex h-12 items-center justify-center border-b border-border-0/50 font-mono text-[12px] text-fg-1">
        SDN
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {nav.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex h-10 items-center justify-center rounded-xl border border-transparent",
                "hover:bg-bg-2/50 hover:text-fg-0",
                active
                  ? "border-border-0/60 bg-bg-2/40 text-fg-0"
                  : "text-fg-1",
              )}
              title={item.label}
              aria-label={item.label}
            >
              <Icon className={cn("h-5 w-5", active ? "text-accent-ok" : "text-fg-1 group-hover:text-fg-0")} />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
