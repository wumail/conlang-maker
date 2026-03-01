import { ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalPortalProps {
  open: boolean;
  children: ReactNode;
}

export function ModalPortal({ open, children }: ModalPortalProps) {
  if (!open) return null;
  return createPortal(children, document.body);
}
