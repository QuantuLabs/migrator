# Program Spec

## Goal

Provide a minimal, auditable migration path:

- burn `old QX`
- receive the same amount of `new QX`
- no pricing
- no snapshot-based retail claim path
- no airdrop logic in the program

Token policy:

- V1 is `Tokenkeg` only
- V1 does not support `Token-2022`

## Fixed V1 Decisions

1. Ratio is fixed at `1:1`.
2. V1 supports `Tokenkeg` only.
3. `user_new_qx` ATA must already exist when `migrate_exact` is called.
4. Reserve is held in a token account owned by a PDA controlled by the program.
5. No per-user migration account is stored on-chain in V1.
6. Snapshot is off-chain audit data only.
7. V1 is open to any live holder of burnable `old QX`; there is no on-chain allowlist or Merkle root.
8. No late-claim penalty in V1.
9. No admin instruction can change the ratio or swap the mint addresses after initialization.

## Instructions

### 0. `initialize_config(start_ts: i64, end_ts: i64, migration_cap: u64)`

Admin-only one-time initialization.

Purpose:

- create and initialize `MigrationConfig`
- bind the program to the immutable mint pair
- bind the reserve vault
- store the live migration window
- bind an immutable total migration cap

Expected accounts:

1. `[signer, writable]` initializer authority
2. `[signer]` ops admin / multisig
3. `[writable]` config PDA
4. `[]` vault authority PDA
5. `[]` vault new QX token account
6. `[]` old QX mint
7. `[]` new QX mint
8. `[]` token program
9. `[]` system program
10. `[]` program data account

Required checks:

- initializer matches the program upgrade authority from `ProgramData`
- config PDA matches seeds
- vault authority PDA matches seeds
- `old QX` mint and `new QX` mint are different
- neither mint is the native mint / wrapped-SOL mint
- both mints belong to the same supported token program
- both mints are initialized
- both mints have `mintAuthority == None`
- both mints have `freezeAuthority == None`
- both mints have matching decimals
- reserve vault mint equals `new QX`
- reserve vault owner equals vault authority PDA
- reserve vault delegate and close-authority controls are cleared
- `migration_cap > 0`
- reserve vault balance is at least `migration_cap`
- `start_ts <= end_ts`

### 1. `set_pause(paused: bool)`

Admin-only emergency control.

Expected accounts:

1. `[signer]` admin
2. `[writable]` config PDA

Required checks:

- signer matches `config.admin`

### 2. `migrate_exact(amount_in: u64)`

Main retail migration path.

Expected accounts:

1. `[signer]` user
2. `[writable]` config PDA
3. `[]` vault authority PDA
4. `[writable]` vault new QX token account
5. `[writable]` user old QX token account
6. `[writable]` user new QX token account
7. `[writable]` old QX mint
8. `[]` new QX mint
9. `[]` token program

Required checks:

- `amount_in > 0`
- migration window is open
- `config.paused == false`
- config PDA and vault PDA seeds re-derive on-chain
- user old token account owner is `user`
- user old token account mint is `old QX`
- user new token account owner is `user`
- user new token account mint is `new QX`
- user new token account address is the canonical ATA for `(user, new QX mint)`
- user new token account has no delegate, close-authority, or wrapped-native controls
- both user token accounts are initialized
- reserve vault mint is `new QX`
- reserve vault owner is vault authority PDA
- reserve vault delegate and close-authority controls are cleared
- reserve vault balance is at least `amount_in`
- `config.total_migrated + amount_in <= migration_cap`

Effects:

1. burn `amount_in` from `user old QX`
2. transfer `amount_in` from reserve vault to `user new QX`
3. increment `config.total_migrated`
4. emit migration log marker

Important runtime note:

- the transaction is atomic, so if the transfer fails after the burn CPI, the whole transaction reverts
- `migration_cap` is stored in `reserved[0..8]` to keep the binary layout size stable in V1

## PDA Seeds

- `MigrationConfig PDA`: `[b"migration-config"]`
- `VaultAuthority PDA`: `[b"vault-authority"]`

## Config Layout

Suggested `#[repr(C)]` layout:

Total size: `296 bytes`

Padding note:

- `repr(C)` inserts padding before `total_migrated`, so the final scalar offsets are `208 / 216 / 224 / 232`, not a packed continuation after byte `204`

| Field | Type |
|---|---|
| tag | `[u8; 8]` |
| version | `u8` |
| bump | `u8` |
| vault_authority_bump | `u8` |
| paused | `u8` |
| admin | `[u8; 32]` |
| old_qx_mint | `[u8; 32]` |
| new_qx_mint | `[u8; 32]` |
| token_program_id | `[u8; 32]` |
| vault_authority | `[u8; 32]` |
| vault_new_qx | `[u8; 32]` |
| total_migrated | `u64` |
| start_ts | `i64` |
| end_ts | `i64` |
| reserved | `[u8; 64]` (`reserved[0..8]` = `migration_cap`) |

## Invariants

1. `config.old_qx_mint` never changes after init.
2. `config.new_qx_mint` never changes after init.
3. `config.vault_new_qx` never changes after init.
4. `total_migrated` is monotonic.
5. `total_migrated <= migration_cap`.
6. Program never mints `new QX`; it only transfers from a pre-funded reserve.
7. Program never transfers `old QX` anywhere; it only burns it.
8. Program never accepts a caller-provided authority or destination without validating it against config and PDA seeds.

## Frontend Contract

The frontend should rely on a tiny manual SDK, not Anchor IDL.

Minimum client helpers:

- `findMigrationConfigPda(programId)` -> `[pubkey, bump]`
- `findVaultAuthorityPda(programId)` -> `[pubkey, bump]`
- `buildInitializeConfigIx(...)`
- `buildSetPauseIx(...)`
- `buildMigrateExactIx(...)`
- `decodeMigrationConfig(data)`

Instruction encoding:

- byte `0`: discriminator
- remaining bytes: fixed little-endian payload

Initial discriminator map:

- `0` => `initialize_config(start_ts, end_ts, migration_cap)`
- `1` => `set_pause(paused)`
- `2` => `migrate_exact(amount_in)`

## Ops Notes

- `vault_new_qx` should be funded before public launch
- `migration_cap` should equal the approved migration total for the open live-holder window
- if any legacy balances are intentionally excluded, they must be operationally locked or removed before launch because V1 does not enforce wallet-level eligibility on-chain
- the final Bags mint must be verified as `Tokenkeg` before mainnet initialization
- public docs must publish:
  - program id
  - config PDA
  - reserve vault address
  - old mint
  - new mint
- UI should auto-create `user_new_qx` ATA before calling `migrate_exact`
