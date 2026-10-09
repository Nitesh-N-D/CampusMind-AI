import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone: "error" | "success" | "warning" | "info";
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = "error") => {
    const id = ++counter;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    // Errors and warnings stay a little longer so they can be read and acted on.
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      tone === "error" || tone === "warning" ? 8000 : 5000
    );
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toastError(message: string) {
  useToastStore.getState().push(message, "error");
}

export function toastSuccess(message: string) {
  useToastStore.getState().push(message, "success");
}

export function toastWarning(message: string) {
  useToastStore.getState().push(message, "warning");
}

export function toastInfo(message: string) {
  useToastStore.getState().push(message, "info");
}
