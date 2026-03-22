# Tokenkeg-Only Checklist

Use this checklist before initializing the mainnet migration config.

## Objective

Confirm that the final Bags `new QX` mint is compatible with the V1 migrator.

V1 requires:

- classic SPL `Tokenkeg`
- `mintAuthority == null`
- `freezeAuthority == null`
- initialized mint account

## Pass Criteria

The final `new QX` mint must satisfy all of the following:

1. `owner == TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
2. mint `space == 82`
3. `isInitialized == true`
4. `mintAuthority == null`
5. `freezeAuthority == null`
6. decimals match expected token config
7. reserve vault mint equals the exact `new QX` mint
8. reserve vault owner equals the migrator vault authority PDA

## Solana RPC Check

Replace `NEW_QX_MINT` with the final mint address:

```bash
curl -s https://api.mainnet-beta.solana.com \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
      "method":"getAccountInfo",
      "params":[
        "NEW_QX_MINT",
      {"encoding":"jsonParsed","commitment":"finalized"}
      ]
    }'
```

Expected shape:

- `owner` = `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- `data.space` = `82`
- `data.parsed.info.isInitialized` = `true`
- `data.parsed.info.mintAuthority` = `null`
- `data.parsed.info.freezeAuthority` = `null`

## Supply Check

```bash
curl -s https://api.mainnet-beta.solana.com \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
      "method":"getTokenSupply",
      "params":[
        "NEW_QX_MINT",
      {"commitment":"finalized"}
      ]
    }'
```

Use this to confirm:

- decimals
- displayed supply
- reserve math assumptions

## SDK Checks

From `sdk/`:

```bash
npm run verify-mint -- <NEW_QX_MINT> <EXPECTED_DECIMALS>
npm run verify-vault -- <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT>
npm run verify-config -- <PROGRAM_ID> <OLD_QX_MINT> <NEW_QX_MINT> <RESERVE_VAULT> <OPS_ADMIN>
npm run verify-program-authority -- <PROGRAM_ID> <EXPECTED_AUTHORITY|none>
npm run reserve-proof -- <PROGRAM_ID> <NEW_QX_MINT> <RESERVE_VAULT> <ELIGIBLE_RAW_UNITS> <EXPECTED_DECIMALS> [FUNDING_SIGNATURE]
```

Use these to confirm:

- the final mint has the expected `Tokenkeg` shape
- the final mint decimals match the launch configuration exactly
- the reserve vault mint equals the final `new QX` mint
- the reserve vault owner equals the migrator vault authority PDA
- reserve vault delegate and close-authority controls are cleared
- the deployed config account matches the published address set exactly
- the current `ProgramData` authority matches the published upgrade-authority policy
- the reserve proof artifact is generated from reproducible RPC inputs
- all scripts exit nonzero on any mismatch

## Reserve Proof Artifact

Before mainnet init, record and publish an internal proof bundle containing:

- exact `old QX` eligible supply input used for the migration math
- exact `new QX` reserve balance in raw base units
- mint decimals used in the comparison
- RPC endpoint and commitment used for the reads
- timestamp of the RPC reads
- slot of the proof reads
- transaction signature that funded the reserve vault
- reviewer sign-off that `reserve >= eligible`

## Example Bags Token Reference

On `2026-03-22`, the Bags token below passed the `Tokenkeg` shape check:

- mint: `Ga7oQU8gvAoRU65Krm2ipy8QVEm2ksc7ZY25EVqFBAGS`
- owner: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- `space = 82`
- `mintAuthority = null`
- `freezeAuthority = null`

This is a reference example only. Always verify the final `new QX` mint directly.
