import { useEffect, useState } from 'react';
import { Alert, Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/primitives';

interface ProofStep {
  key: string;
  label: string;
  status: 'pending' | 'active' | 'complete';
}

interface ProofGenerationModalProps {
  error?: string | null;
  isGenerating: boolean;
  isOpen: boolean;
  onClose: () => void;
  proofTime?: string | null;
  steps: ProofStep[];
  title: string;
}

export default function ProofGenerationModal({
  error,
  isGenerating,
  isOpen,
  onClose,
  proofTime,
  steps,
  title,
}: ProofGenerationModalProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isOpen || !isGenerating) {
      setElapsedSeconds(0);
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isGenerating, isOpen]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isGenerating) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <Badge variant="secondary">Browser Prover</Badge>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isGenerating
              ? `Generating proof... ${elapsedSeconds}s`
              : proofTime
                ? `Proof completed in ${proofTime}.`
                : 'Client-side proving keeps sensitive credential inputs local to the browser.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <div className="rounded-[var(--radius)] border border-border bg-surface px-4 py-5">
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Status</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={error ? 'destructive' : isGenerating ? 'accent' : 'success'}>
                {error ? 'Interrupted' : isGenerating ? 'Running' : 'Ready'}
              </Badge>
              <Badge variant="outline">{proofTime ? proofTime : 'Local only'}</Badge>
            </div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-surface px-4 py-5">
            <div className="grid gap-3">
              {steps.map((step) => (
                <div key={step.key} className="flex items-center gap-3">
                  <span
                    className={[
                      'h-2.5 w-2.5 rounded-full',
                      step.status === 'complete'
                        ? 'bg-success'
                        : step.status === 'active'
                          ? 'bg-accent'
                          : 'bg-text-tertiary',
                    ].join(' ')}
                  />
                  <span className="text-sm text-text-secondary">{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <Alert
            description={error}
            title="Proof generation failed"
            variant="destructive"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
