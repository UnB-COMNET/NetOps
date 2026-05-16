import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen overflow-hidden bg-bg-0 text-fg-0">
      <Sidebar />
      <div className="flex h-full flex-col pl-16">
        <div className="flex-shrink-0">
          <StatusBar />
        </div>
        <main className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</main>
      </div>
    </div>
  );
}
