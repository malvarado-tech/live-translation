"use client";

/**
 * Bottom sheet on a native modal <dialog>: focus stays inside, Esc closes
 * it, a tap on the backdrop closes it, and focus returns to the control
 * that opened it.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/controls";

export function Sheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  testId,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  testId?: string;
  lang?: string;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute("open", "");
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      data-testid={testId}
      lang={lang}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A tap on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-xl border border-b-0 border-line bg-panel p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-5 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className={buttonClass("ghost", "sm")}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
