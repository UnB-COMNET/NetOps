import { cn } from "@/lib/cn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-lg border border-border-0/60 bg-bg-2/90 px-2 text-[12px] text-white",
        "placeholder:text-fg-1/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ok/40",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-border-0/60 bg-bg-2/90 px-2 text-[12px] text-white font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ok/40",
        "cursor-pointer hover:bg-bg-2",
        className,
      )}
      {...props}
    />
  );
}
