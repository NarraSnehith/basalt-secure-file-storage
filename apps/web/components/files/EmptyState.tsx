import { ColumnArt } from '@/components/brand/ColumnArt';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  body,
  action,
  seed = 11,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  seed?: number;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="relative mb-6 h-24 w-40 overflow-hidden" style={{ color: 'var(--line-strong)' }}>
        <ColumnArt seed={seed} columns={14} className="h-full w-full" />
      </div>
      <h3 className="text-[0.9375rem] font-medium">{title}</h3>
      <p className="mt-1.5 max-w-[26rem] text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
        {body}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
