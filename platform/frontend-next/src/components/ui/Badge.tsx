import { cn } from "@/lib/cn";

type BadgeTone = "neutral" | "ok" | "danger";

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "border-border-0/60 bg-bg-2/30 text-fg-1",
        tone === "ok" && "border-accent-ok/40 bg-accent-ok/10 text-accent-ok",
        tone === "danger" && "border-accent-danger/40 bg-accent-danger/10 text-accent-danger",
      )}
    >
      {children}
    </span>
  );
}
