declare module 'circomlibjs' {
  interface FiniteField {
    e: (value: bigint | number | string) => unknown;
    toObject: (value: unknown) => bigint;
    toString: (value: unknown) => string;
  }

  interface BabyJubPoint extends Array<unknown> {
    0: unknown;
    1: unknown;
  }

  interface BabyJub {
    F: FiniteField;
    addPoint: (left: BabyJubPoint, right: BabyJubPoint) => BabyJubPoint;
    mulPointEscalar: (point: BabyJubPoint, scalar: bigint) => BabyJubPoint;
  }

  interface Eddsa {
    babyJub: BabyJub;
    signPoseidon: (
      privateKey: Uint8Array,
      message: unknown,
    ) => {
      R8: BabyJubPoint;
      S: bigint;
    };
  }

  export function buildBabyjub(): Promise<BabyJub>;
  export function buildEddsa(): Promise<Eddsa>;
  export function buildPoseidon(): Promise<
    ((inputs: bigint[]) => unknown) & {
      F: {
        toString: (value: unknown) => string;
      };
    }
  >;
}

declare module 'snarkjs' {
  export const groth16: {
    fullProve: (
      witness: Record<string, unknown>,
      wasmUrl: string,
      zkeyUrl: string,
    ) => Promise<{ proof: unknown; publicSignals: unknown[] }>;
  };
}
