export function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-elevated font-[var(--font-display)] text-base" style={{ fontFamily: 'var(--font-display)' }}>
        V
      </div>
      <span className="text-lg tracking-[-0.02em] text-text-primary" style={{ fontFamily: 'var(--font-display)' }}>
        VaultProof
      </span>
    </div>
  );
}
