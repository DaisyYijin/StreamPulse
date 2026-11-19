import { cx } from '../utils';

export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('logo-mark', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" role="img" aria-label="StreamPulse">
        <rect width="40" height="40" rx="12" fill="currentColor" opacity="0.12" />
        <path
          d="M7 21h5.2l2.6-8.4 4.9 16.2 3.7-12 2.4 6.2h7.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="32.4" cy="18" r="2.2" fill="currentColor" />
      </svg>
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cx('logo', compact && 'logo-compact')}>
      <LogoMark />
      {compact ? null : (
        <span className="logo-type">
          Stream<span>Pulse</span>
        </span>
      )}
    </span>
  );
}
