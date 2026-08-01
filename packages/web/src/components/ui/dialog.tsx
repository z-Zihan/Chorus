import {
  Close as DialogClosePrimitive,
  Content as DialogContentPrimitive,
  Description as DialogDescriptionPrimitive,
  Dialog as DialogPrimitive,
  Overlay as DialogOverlayPrimitive,
  Portal as DialogPortalPrimitive,
  Title as DialogTitlePrimitive,
  Trigger as DialogTriggerPrimitive,
} from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive;
export const DialogTrigger = DialogTriggerPrimitive;
export const DialogPortal = DialogPortalPrimitive;
export const DialogClose = DialogClosePrimitive;

export const DialogOverlay = forwardRef<
  ComponentRef<typeof DialogOverlayPrimitive>,
  ComponentPropsWithoutRef<typeof DialogOverlayPrimitive>
>(({ className, ...props }, ref) => (
  <DialogOverlayPrimitive
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=closed]:animate-[fade-out_150ms_ease-in] data-[state=open]:animate-[fade-in_150ms_ease-out]",
      className,
    )}
    {...props}
  />
));

DialogOverlay.displayName = "DialogOverlay";

const dialogContentVariants = cva(
  "fixed z-50 border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xl outline-none",
  {
    variants: {
      variant: {
        centered:
          "left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl p-5",
        drawer:
          "inset-y-0 right-0 flex h-full w-full max-w-md flex-col border-y-0 border-r-0 data-[state=closed]:translate-x-full data-[state=open]:translate-x-0 data-[state=closed]:duration-150 data-[state=open]:duration-200 data-[state=closed]:ease-in data-[state=open]:ease-out",
      },
    },
    defaultVariants: { variant: "centered" },
  },
);

interface DialogContentProps
  extends
    ComponentPropsWithoutRef<typeof DialogContentPrimitive>,
    VariantProps<typeof dialogContentVariants> {
  overlayClassName?: string;
}

export const DialogContent = forwardRef<
  ComponentRef<typeof DialogContentPrimitive>,
  DialogContentProps
>(({ className, children, variant, overlayClassName, ...props }, ref) => (
  <DialogPortalPrimitive>
    <DialogOverlay className={overlayClassName} />
    <DialogContentPrimitive
      ref={ref}
      className={cn(
        dialogContentVariants({ variant }),
        variant === "drawer" && "transition-transform",
        className,
      )}
      {...props}
    >
      {children}
    </DialogContentPrimitive>
  </DialogPortalPrimitive>
));

DialogContent.displayName = "DialogContent";

export const DialogTitle = forwardRef<
  ComponentRef<typeof DialogTitlePrimitive>,
  ComponentPropsWithoutRef<typeof DialogTitlePrimitive>
>(({ className, ...props }, ref) => (
  <DialogTitlePrimitive
    ref={ref}
    className={cn("text-base font-semibold text-[var(--text-primary)]", className)}
    {...props}
  />
));

DialogTitle.displayName = "DialogTitle";

export const DialogDescription = forwardRef<
  ComponentRef<typeof DialogDescriptionPrimitive>,
  ComponentPropsWithoutRef<typeof DialogDescriptionPrimitive>
>(({ className, ...props }, ref) => (
  <DialogDescriptionPrimitive
    ref={ref}
    className={cn("text-sm leading-6 text-[var(--text-secondary)]", className)}
    {...props}
  />
));

DialogDescription.displayName = "DialogDescription";
