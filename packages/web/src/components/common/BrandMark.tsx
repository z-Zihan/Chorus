import { cn } from "@/lib/cn";

interface BrandMarkProps {
  className?: string;
  title?: string;
}

export function BrandMark({ className, title = "Chorus" }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} className={cn("shrink-0", className)}>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <g
        fill="none"
        stroke="var(--accent-foreground)"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 9.8c4.4 0 5 3 9.2 3.7" />
        <path d="M7.5 16h12.8" />
        <path d="M9 22.2c4.4 0 5-3 9.2-3.7" />
        <path d="M20.3 16c2.4 0 3.8 1.5 3.8 3.6v2.3l-2.4-1.8" />
      </g>
      <g fill="var(--accent-foreground)">
        <circle cx="9" cy="9.8" r="1.35" />
        <circle cx="7.5" cy="16" r="1.35" />
        <circle cx="9" cy="22.2" r="1.35" />
      </g>
    </svg>
  );
}
