import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "ghost" | "danger";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[12px] font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ok/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "border-border-0/60 bg-bg-2/70 text-fg-0 hover:bg-bg-2",
        variant === "ghost" &&
          "border-border-0/40 bg-transparent text-fg-1 hover:bg-bg-1/60 hover:text-fg-0",
        variant === "danger" &&
          "border-accent-danger/40 bg-accent-danger/10 text-accent-danger hover:bg-accent-danger/15",
        className,
      )}
      {...props}
    />
  );
}
