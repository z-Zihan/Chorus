import { voiceChipColor } from "@/lib/agentColor";

interface Props {
  name: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

const SIZE_MAP = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function AgentAvatar({ name, src, size = "md" }: Props) {
  const sizeClass = SIZE_MAP[size];

  if (src) {
    return <img src={src} alt={name} className={`${sizeClass} rounded-full object-cover`} />;
  }

  return (
    <div
      className={`${sizeClass} flex flex-shrink-0 items-center justify-center rounded-full font-medium text-white`}
      style={{ backgroundColor: voiceChipColor(name) }}
    >
      {getInitials(name)}
    </div>
  );
}
