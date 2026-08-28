import {
  Arrow as TooltipArrowPrimitive,
  Content as TooltipContentPrimitive,
  Portal as TooltipPortalPrimitive,
  Provider as TooltipProviderPrimitive,
  Root as TooltipPrimitive,
  Trigger as TooltipTriggerPrimitive,
} from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipProviderPrimitive;
export const Tooltip = TooltipPrimitive;
export const TooltipTrigger = TooltipTriggerPrimitive;

export const TooltipContent = forwardRef<
  ComponentRef<typeof TooltipContentPrimitive>,
  ComponentPropsWithoutRef<typeof TooltipContentPrimitive>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPortalPrimitive>
    <TooltipContentPrimitive
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[70] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] shadow-[var(--shadow-pop)]",
        className,
      )}
      {...props}
    >
      {children}
      <TooltipArrowPrimitive className="fill-[var(--bg-elevated)]" />
    </TooltipContentPrimitive>
  </TooltipPortalPrimitive>
));

TooltipContent.displayName = "TooltipContent";
