import { useToastStore } from "@/lib/toastStore";

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-full">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flex items-start gap-2.5 rounded-[var(--radius-control)] border px-4 py-3 text-sm shadow-[var(--shadow-raised)] animate-[fadeIn_0.15s_ease] ${
            t.tone === "error"
              ? "bg-seal-coral-50 border-seal-coral-100 text-seal-coral-900"
              : "bg-seal-teal-50 border-seal-teal-100 text-seal-teal-900"
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="shrink-0 mt-0.5"
            aria-hidden="true"
          >
            {t.tone === "error" ? (
              <>
                <path d="M12 3 3 20h18L12 3Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 9.5v4.5M12 17h.01" strokeWidth="1.8" strokeLinecap="round" />
              </>
            ) : (
              <path d="m5 13 4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
          <span className="flex-1">{t.message}</span>
          <button
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
