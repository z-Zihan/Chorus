import { cn } from "@/lib/cn";

interface BrandMarkProps {
  className?: string;
  title?: string;
}

export function BrandMark({ className, title = "Chorus" }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} className={cn("shrink-0", className)}>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <g fill="none" stroke="var(--accent-foreground)" strokeWidth="2" strokeLinecap="round">
        <path d="m9.9 9.8 3.2 3.1M24.3 16h-2.5M9.9 22.2l3.2-3.1M19.6 19.6l1.5 1.5" />
        <circle cx="16" cy="16" r="5.2" />
      </g>
      <g fill="var(--accent-foreground)" stroke="var(--accent-foreground)" strokeWidth="0.7">
        <circle cx="8.7" cy="8.6" r="1.45" />
        <circle cx="25.3" cy="16" r="1.45" />
        <circle cx="8.7" cy="23.4" r="1.45" />
      </g>
    </svg>
  );
}
