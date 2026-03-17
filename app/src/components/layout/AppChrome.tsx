export function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-elevated text-sm font-semibold">
        VP
      </div>
      <div className="flex flex-col">
        <span className="text-base font-semibold tracking-[-0.02em] text-text-primary">
          VaultProof
        </span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-text-tertiary">
          Institutional Compliance Vaults
        </span>
      </div>
    </div>
  );
}
