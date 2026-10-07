import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

/** Shown wherever a list is legitimately empty, rather than leaving a blank. */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
        {body}
      </p>
    </div>
  );
}
