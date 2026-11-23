import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="spin" size={16} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  className,
  children,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Badge({
  tone = 'neutral',
  live = false,
  children,
  className,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  live?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx('badge', `badge-${tone}`, className)}>
      {live ? <span className="badge-dot" /> : null}
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cx('field', className)}>
      <span className="field-label">
        {label}
        {optional ? <em>可选</em> : null}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={cx('input', invalid && 'input-invalid', className)} {...rest} />;
}

export function Textarea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cx('input textarea', invalid && 'input-invalid', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('input select', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? '切换'}
      className={cx('toggle', checked && 'toggle-on')}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner" role="status">
      <Loader2 className="spin" size={size} />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx('skeleton', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('empty-state', compact && 'empty-compact')}>
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-overlay"
      ref={overlayRef}
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) onClose();
      }}
    >
      <div className={cx('modal', `modal-${size}`)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认删除',
  danger = true,
  loading = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="confirm-text">{description}</p>
    </Modal>
  );
}

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

function dispatchToast(message: string, tone: ToastTone) {
  window.dispatchEvent(
    new CustomEvent('sp:toast', {
      detail: { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, tone },
    }),
  );
}

export const toast = {
  success: (message: string) => dispatchToast(message, 'success'),
  error: (message: string) => dispatchToast(message, 'error'),
  info: (message: string) => dispatchToast(message, 'info'),
};

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ToastItem>).detail;
      setItems((current) => [...current.slice(-3), detail]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== detail.id));
      }, 4200);
    };
    window.addEventListener('sp:toast', handler);
    return () => window.removeEventListener('sp:toast', handler);
  }, []);

  return createPortal(
    <div className="toast-viewport" aria-live="polite">
      {items.map((item) => (
        <div className={cx('toast', `toast-${item.tone}`)} key={item.id}>
          {item.tone === 'success' ? (
            <CheckCircle2 size={18} />
          ) : item.tone === 'error' ? (
            <AlertTriangle size={18} />
          ) : (
            <Info size={18} />
          )}
          <span>{item.message}</span>
          <button
            aria-label="关闭提示"
            onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success('已复制');
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error('复制失败，请手动选择文本');
        }
      }}
    >
      {copied ? '已复制' : label}
    </Button>
  );
}
