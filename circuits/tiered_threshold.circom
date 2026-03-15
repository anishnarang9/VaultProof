pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";

// Computes the effective AML threshold based on accreditation status and credential expiry.
//
// Accreditation tiers (USDC with 6 decimals):
//   0 = retail:        $10,000   = 10_000_000_000
//   1 = accredited:    $1,000,000 = 1_000_000_000_000
//   2 = institutional: effectively unlimited (max u64)
//
// Soft expiry: if credential is expired, threshold is downgraded to $1,000 = 1_000_000_000
template TieredThreshold() {
    signal input accreditationStatus;   // 0, 1, or 2
    signal input credentialExpiry;      // unix timestamp
    signal input currentTimestamp;      // unix timestamp (public)

    signal output effectiveThreshold;

    // --- Tier selection ---
    var RETAIL_THRESHOLD = 10000000000;              // $10,000
    var ACCREDITED_THRESHOLD = 1000000000000;        // $1,000,000
    var INSTITUTIONAL_THRESHOLD = 18446744073709551615; // max u64

    component isAccredited = IsEqual();
    isAccredited.in[0] <== accreditationStatus;
    isAccredited.in[1] <== 1;

    component isInstitutional = IsEqual();
    isInstitutional.in[0] <== accreditationStatus;
    isInstitutional.in[1] <== 2;

    signal tierThreshold;
    tierThreshold <== RETAIL_THRESHOLD
        + isAccredited.out * (ACCREDITED_THRESHOLD - RETAIL_THRESHOLD)
        + isInstitutional.out * (INSTITUTIONAL_THRESHOLD - ACCREDITED_THRESHOLD);

    // --- Soft expiry check ---
    var EXPIRED_THRESHOLD = 1000000000; // $1,000

    component isExpired = LessThan(64);
    isExpired.in[0] <== credentialExpiry;
    isExpired.in[1] <== currentTimestamp;
    // isExpired.out = 1 if credentialExpiry < currentTimestamp (expired)

    // If expired, override to EXPIRED_THRESHOLD; otherwise use tierThreshold
    // effectiveThreshold = tierThreshold + isExpired * (EXPIRED_THRESHOLD - tierThreshold)
    //                    = tierThreshold * (1 - isExpired) + EXPIRED_THRESHOLD * isExpired
    effectiveThreshold <== tierThreshold + isExpired.out * (EXPIRED_THRESHOLD - tierThreshold);
}
