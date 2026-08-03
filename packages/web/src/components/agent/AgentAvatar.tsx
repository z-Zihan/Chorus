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

// Color palette for avatar backgrounds based on name hash
const COLORS = [
  "bg-teal-600",
  "bg-cyan-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-sky-600",
  "bg-lime-600",
];

function getColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

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
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${getColor(
        name
      )} flex flex-shrink-0 items-center justify-center rounded-full font-medium text-white`}
    >
      {getInitials(name)}
    </div>
  );
}
