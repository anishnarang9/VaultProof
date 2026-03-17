import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Button({
  className,
  size = 'default',
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'default' | 'sm' | 'lg' | 'icon';
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full border text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-45',
        variant === 'default' && 'border-transparent bg-accent text-white hover:bg-accent-hover',
        variant === 'secondary' && 'border-border bg-surface text-text-primary hover:bg-elevated',
        variant === 'outline' &&
          'border-border bg-transparent text-text-secondary hover:border-white/14 hover:text-text-primary',
        variant === 'ghost' && 'border-transparent bg-transparent text-text-secondary hover:text-text-primary',
        variant === 'destructive' && 'border-danger/40 bg-danger/12 text-danger hover:bg-danger/18',
        size === 'default' && 'h-11 px-5',
        size === 'sm' && 'h-9 px-4 text-xs',
        size === 'lg' && 'h-12 px-6',
        size === 'icon' && 'h-10 w-10 rounded-full',
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[calc(var(--radius)*2)] border border-border bg-surface',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-2 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-xl font-semibold tracking-[-0.03em] text-text-primary', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-6 text-text-secondary', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap gap-3 px-6 pb-6', className)} {...props} />;
}

export function Badge({
  children,
  className,
  variant = 'outline',
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: 'accent' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]',
        variant === 'accent' && 'border-accent/30 bg-accent/12 text-accent',
        variant === 'secondary' && 'border-border bg-elevated text-text-secondary',
        variant === 'outline' && 'border-border text-text-tertiary',
        variant === 'success' && 'border-success/20 bg-success/10 text-success',
        variant === 'warning' && 'border-warning/20 bg-warning/10 text-warning',
        variant === 'destructive' && 'border-danger/20 bg-danger/10 text-danger',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  className,
  description,
  title,
  variant = 'default',
}: {
  className?: string;
  description: ReactNode;
  title: ReactNode;
  variant?: 'default' | 'warning' | 'destructive' | 'success';
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border px-4 py-3',
        variant === 'default' && 'border-border bg-elevated',
        variant === 'warning' && 'border-warning/20 bg-warning/10',
        variant === 'destructive' && 'border-danger/20 bg-danger/10',
        variant === 'success' && 'border-success/20 bg-success/10',
        className,
      )}
    >
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-[var(--radius)] border border-border bg-bg-primary px-4 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-white/16',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'text-[11px] font-medium uppercase tracking-[0.24em] text-text-tertiary',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full appearance-none rounded-[var(--radius)] border border-border bg-bg-primary px-4 text-sm text-text-primary outline-none transition-colors focus:border-white/16',
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-border', className)} />;
}

const DialogContext = createContext<{
  onOpenChange: (open: boolean) => void;
  open: boolean;
} | null>(null);

export function Dialog({
  children,
  onOpenChange,
  open,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>{children}</DialogContext.Provider>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('text-2xl font-semibold tracking-[-0.03em] text-text-primary', className)} {...props} />
  );
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-6 text-text-secondary', className)} {...props} />;
}

export function DialogContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const context = useContext(DialogContext);

  useEffect(() => {
    if (!context?.open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        context.onOpenChange(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [context]);

  if (!context?.open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-10"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          context.onOpenChange(false);
        }
      }}
      role="presentation"
    >
      <div
        className={cn(
          'relative w-full rounded-[calc(var(--radius)*2)] border border-border bg-surface p-6',
          className,
        )}
      >
        <button
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-elevated text-text-secondary transition-colors hover:text-text-primary"
          onClick={() => context.onOpenChange(false)}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const TabsContext = createContext<{
  setValue: (value: string) => void;
  value: string;
} | null>(null);

export function Tabs({
  children,
  defaultValue,
  value,
  onValueChange,
}: {
  children: ReactNode;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  value?: string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const activeValue = value ?? internalValue;
  const contextValue = useMemo(
    () => ({
      setValue: (nextValue: string) => {
        if (value === undefined) {
          setInternalValue(nextValue);
        }
        onValueChange?.(nextValue);
      },
      value: activeValue,
    }),
    [activeValue, onValueChange, value],
  );

  return <TabsContext.Provider value={contextValue}>{children}</TabsContext.Provider>;
}

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex rounded-full border border-border bg-surface p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  children,
  className,
  value,
}: {
  children: ReactNode;
  className?: string;
  value: string;
}) {
  const context = useContext(TabsContext);
  const active = context?.value === value;

  return (
    <button
      className={cn(
        'rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors',
        active ? 'bg-elevated text-text-primary' : 'text-text-tertiary hover:text-text-primary',
        className,
      )}
      onClick={() => context?.setValue(value)}
      type="button"
    >
      {children}
    </button>
  );
}

export function TabsContent({
  children,
  className,
  value,
}: {
  children: ReactNode;
  className?: string;
  value: string;
}) {
  const context = useContext(TabsContext);

  if (context?.value !== value) {
    return null;
  }

  return <div className={className}>{children}</div>;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left', className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-border', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-b-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('border-b border-border transition-colors hover:bg-white/[0.015]', className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-[11px] font-medium uppercase tracking-[0.22em] text-text-tertiary',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-4 text-sm text-text-secondary', className)} {...props} />;
}

type ToastVariant = 'default' | 'success' | 'warning' | 'destructive';

type ToastEntry = {
  description?: string;
  id: string;
  title: string;
  variant: ToastVariant;
};

const ToastContext = createContext<{
  toast: (toast: Omit<ToastEntry, 'id'>) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    const timers = items.map((item) =>
      window.setTimeout(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      }, 4000),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [items]);

  const contextValue = useMemo(
    () => ({
      toast: (toast: Omit<ToastEntry, 'id'>) => {
        const id =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2);
        setItems((current) => [...current, { ...toast, id }]);
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto rounded-[calc(var(--radius)*1.5)] border px-4 py-3',
              item.variant === 'default' && 'border-border bg-surface',
              item.variant === 'success' && 'border-success/20 bg-success/10',
              item.variant === 'warning' && 'border-warning/20 bg-warning/10',
              item.variant === 'destructive' && 'border-danger/20 bg-danger/10',
            )}
          >
            <p className="text-sm font-medium text-text-primary">{item.title}</p>
            {item.description ? (
              <p className="mt-1 text-sm leading-6 text-text-secondary">{item.description}</p>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    return {
      toast: () => undefined,
    };
  }

  return context;
}
