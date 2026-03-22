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
2. parsed `program == spl-token`
3. mint `space == 82`
4. `isInitialized == true`
5. `mintAuthority == null`
6. `freezeAuthority == null`
7. decimals match expected token config
8. reserve vault mint equals the exact `new QX` mint
9. reserve vault owner equals the migrator vault authority PDA

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
      {"encoding":"jsonParsed","commitment":"confirmed"}
    ]
  }'
```

Expected shape:

- `owner` = `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- `data.program` = `spl-token`
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
      {"commitment":"confirmed"}
    ]
  }'
```

Use this to confirm:

- decimals
- displayed supply
- reserve math assumptions

## Example Bags Token Reference

On `2026-03-22`, the Bags token below passed the `Tokenkeg` shape check:

- mint: `Ga7oQU8gvAoRU65Krm2ipy8QVEm2ksc7ZY25EVqFBAGS`
- owner: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- parsed program: `spl-token`
- `space = 82`
- `mintAuthority = null`
- `freezeAuthority = null`

This is a reference example only. Always verify the final `new QX` mint directly.
