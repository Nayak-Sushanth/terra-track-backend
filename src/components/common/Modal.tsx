import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-lg',
  children,
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#17243A]/40 backdrop-blur-[2px] p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidthClass} neu-modal overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b neu-divider px-5 py-4 bg-[#EEF2F7]">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-[#17243A] leading-5">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px] text-[#718096] leading-4">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="neu-btn flex h-8 w-8 items-center justify-center text-[#52627A] hover:text-[#17243A] shrink-0"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto bg-[#EEF2F7] p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2.5 border-t neu-divider bg-[#E9EDF3]/75 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
