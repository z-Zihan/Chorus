import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation("common");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isConfirming) onCancel();
      }}
    >
      <DialogContent
        role="alertdialog"
        onEscapeKeyDown={(event) => {
          if (isConfirming) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isConfirming) event.preventDefault();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="mt-2">{message}</div>
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={isConfirming}>
            {cancelLabel ?? t("buttons.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? t("buttons.deleting") : (confirmLabel ?? t("buttons.confirm"))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
