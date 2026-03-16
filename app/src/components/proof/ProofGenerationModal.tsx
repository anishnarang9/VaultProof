import { AnimatePresence, motion } from 'framer-motion';

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
  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="proof-backdrop"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !isGenerating) {
              onClose();
            }
          }}
        >
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="proof-modal"
            exit={{ opacity: 0, scale: 0.98, y: 18 }}
            initial={{ opacity: 0, scale: 0.98, y: 18 }}
            transition={{ duration: 0.24 }}
          >
            <div className="proof-modal-header">
              <div>
                <p className="eyebrow">Browser prover</p>
                <h2>{title}</h2>
              </div>
              <button className="button button-secondary" onClick={onClose} type="button">
                Close
              </button>
            </div>

            <div className="proof-status-band">
              <span className={`status-pill${error ? ' status-pill-error' : ''}`}>
                {error ? 'Interrupted' : isGenerating ? 'Running' : 'Ready'}
              </span>
              <span>{proofTime ? `Proof time: ${proofTime}` : 'Client-side proving only'}</span>
            </div>

            <div className="proof-step-list">
              {steps.map((step) => (
                <div key={step.key} className="proof-step-row">
                  <span className={`status-dot status-dot-${step.status}`} />
                  <span>{step.label}</span>
                </div>
              ))}
            </div>

            {error ? <p className="inline-error">{error}</p> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
