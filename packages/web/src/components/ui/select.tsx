import {
  Content as SelectContentPrimitive,
  Icon as SelectIconPrimitive,
  Item as SelectItemPrimitive,
  ItemIndicator as SelectItemIndicatorPrimitive,
  ItemText as SelectItemTextPrimitive,
  Portal as SelectPortalPrimitive,
  Root as SelectPrimitive,
  Trigger as SelectTriggerPrimitive,
  Value as SelectValuePrimitive,
  Viewport as SelectViewportPrimitive,
} from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cn } from "@/lib/cn";

export const Select = SelectPrimitive;
export const SelectValue = SelectValuePrimitive;

export const SelectTrigger = forwardRef<
  ComponentRef<typeof SelectTriggerPrimitive>,
  ComponentPropsWithoutRef<typeof SelectTriggerPrimitive>
>(({ className, children, ...props }, ref) => (
  <SelectTriggerPrimitive
    ref={ref}
    className={cn(
      "flex h-11 w-full items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-color)] focus:ring-2 focus:ring-[var(--accent-subtle)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-10",
      className,
    )}
    {...props}
  >
    {children}
    <SelectIconPrimitive asChild>
      <ChevronDown aria-hidden="true" className="h-4 w-4 text-[var(--text-tertiary)]" />
    </SelectIconPrimitive>
  </SelectTriggerPrimitive>
));

SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = forwardRef<
  ComponentRef<typeof SelectContentPrimitive>,
  ComponentPropsWithoutRef<typeof SelectContentPrimitive>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPortalPrimitive>
    <SelectContentPrimitive
      ref={ref}
      position={position}
      className={cn(
        "z-[70] min-w-[8rem] overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xl",
        position === "popper" && "w-[var(--radix-select-trigger-width)]",
        className,
      )}
      {...props}
    >
      <SelectViewportPrimitive className="p-1">{children}</SelectViewportPrimitive>
    </SelectContentPrimitive>
  </SelectPortalPrimitive>
));

SelectContent.displayName = "SelectContent";

export const SelectItem = forwardRef<
  ComponentRef<typeof SelectItemPrimitive>,
  ComponentPropsWithoutRef<typeof SelectItemPrimitive>
>(({ className, children, ...props }, ref) => (
  <SelectItemPrimitive
    ref={ref}
    className={cn(
      "relative flex min-h-11 cursor-default select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-[var(--bg-hover)] data-[disabled]:opacity-50 sm:min-h-0",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <SelectItemIndicatorPrimitive>
        <Check aria-hidden="true" className="h-4 w-4" />
      </SelectItemIndicatorPrimitive>
    </span>
    <SelectItemTextPrimitive>{children}</SelectItemTextPrimitive>
  </SelectItemPrimitive>
));

SelectItem.displayName = "SelectItem";
