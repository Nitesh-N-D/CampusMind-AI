import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone: "error" | "success";
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
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toastError(message: string) {
  useToastStore.getState().push(message, "error");
}

export function toastSuccess(message: string) {
  useToastStore.getState().push(message, "success");
}
