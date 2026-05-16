import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border-0/60 bg-bg-1/40", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border-0/50 px-3 py-2">
      <div className="text-[12px] font-semibold tracking-tight">{title}</div>
      {right ? <div className="text-[11px] text-fg-1">{right}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-3 py-2", className)}>{children}</div>;
}
