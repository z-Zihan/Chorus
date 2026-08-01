import { Root as SwitchPrimitive, Thumb as SwitchThumbPrimitive } from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cn } from "@/lib/cn";

export const Switch = forwardRef<
  ComponentRef<typeof SwitchPrimitive>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive
    ref={ref}
    className={cn(
      "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-[var(--bg-active)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--accent-color)]",
      className,
    )}
    {...props}
  >
    <SwitchThumbPrimitive className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive>
));

Switch.displayName = "Switch";
