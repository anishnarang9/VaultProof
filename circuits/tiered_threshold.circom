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
    signal input retailThreshold;
    signal input accreditedThreshold;
    signal input institutionalThreshold;
    signal input expiredThreshold;

    signal output effectiveThreshold;

    // --- Tier selection ---
    component isAccredited = IsEqual();
    isAccredited.in[0] <== accreditationStatus;
    isAccredited.in[1] <== 1;

    component isInstitutional = IsEqual();
    isInstitutional.in[0] <== accreditationStatus;
    isInstitutional.in[1] <== 2;

    signal accreditedDelta;
    signal institutionalDelta;
    signal accreditedContribution;
    signal institutionalContribution;
    signal tierThreshold;
    accreditedDelta <== accreditedThreshold - retailThreshold;
    institutionalDelta <== institutionalThreshold - accreditedThreshold;
    accreditedContribution <== isAccredited.out * accreditedDelta;
    institutionalContribution <== isInstitutional.out * institutionalDelta;
    tierThreshold <== retailThreshold + accreditedContribution + institutionalContribution;

    component isExpired = LessThan(64);
    isExpired.in[0] <== credentialExpiry;
    isExpired.in[1] <== currentTimestamp;
    // isExpired.out = 1 if credentialExpiry < currentTimestamp (expired)

    signal expiredDelta;
    signal expiredContribution;
    // If expired, override to EXPIRED_THRESHOLD; otherwise use tierThreshold
    // effectiveThreshold = tierThreshold + isExpired * (EXPIRED_THRESHOLD - tierThreshold)
    //                    = tierThreshold * (1 - isExpired) + EXPIRED_THRESHOLD * isExpired
    expiredDelta <== expiredThreshold - tierThreshold;
    expiredContribution <== isExpired.out * expiredDelta;
    effectiveThreshold <== tierThreshold + expiredContribution;
}
