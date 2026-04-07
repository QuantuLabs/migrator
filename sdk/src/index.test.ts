import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";

import {
  MIGRATION_CONFIG_DISCRIMINATOR,
  MIGRATION_CONFIG_SIZE,
  MIGRATION_CONFIG_VERSION,
  TOKEN_PROGRAM_ID,
  decodeMigrationConfig,
  encodeInitializeConfigData,
  encodeMigrateExactData,
  encodeSetPauseData,
  encodeWithdrawUnclaimedData,
} from "./index.ts";

test("instruction payloads use stable opcodes and little-endian scalars", () => {
  const init = encodeInitializeConfigData(100n, 200n, 42n);
  assert.equal(init[0], 0);
  assert.equal(init.readBigInt64LE(1), 100n);
  assert.equal(init.readBigInt64LE(9), 200n);
  assert.equal(init.readBigUInt64LE(17), 42n);

  assert.deepEqual(encodeSetPauseData(true), Buffer.from([1, 1]));
  assert.deepEqual(encodeSetPauseData(false), Buffer.from([1, 0]));

  const migrate = encodeMigrateExactData(999n);
  assert.equal(migrate[0], 2);
  assert.equal(migrate.readBigUInt64LE(1), 999n);

  assert.deepEqual(encodeWithdrawUnclaimedData(), Buffer.from([3]));
});

test("decodeMigrationConfig rejects wrong size, discriminator, and version", () => {
  assert.throws(
    () => decodeMigrationConfig(Buffer.alloc(MIGRATION_CONFIG_SIZE - 1)),
    /exactly 296 bytes/,
  );
  const wrongDisc = Buffer.alloc(MIGRATION_CONFIG_SIZE);
  assert.throws(() => decodeMigrationConfig(wrongDisc), /discriminator/);

  const wrongVer = Buffer.alloc(MIGRATION_CONFIG_SIZE);
  MIGRATION_CONFIG_DISCRIMINATOR.copy(wrongVer, 0);
  wrongVer[8] = 99;
  assert.throws(() => decodeMigrationConfig(wrongVer), /Unsupported MigrationConfig version/);
});

test("decodeMigrationConfig reads on-chain layout including padding before total_migrated", () => {
  const data = Buffer.alloc(MIGRATION_CONFIG_SIZE);
  MIGRATION_CONFIG_DISCRIMINATOR.copy(data, 0);
  data[8] = MIGRATION_CONFIG_VERSION;
  data[9] = 7;
  data[10] = 8;
  data[11] = 1;

  const admin = Buffer.alloc(32, 0x01);
  const sourceMint = Buffer.alloc(32, 0x02);
  const destMint = Buffer.alloc(32, 0x03);
  const tokenProg = TOKEN_PROGRAM_ID.toBuffer();
  const vaultAuth = Buffer.alloc(32, 0x04);
  const reserve = Buffer.alloc(32, 0x05);

  admin.copy(data, 12);
  sourceMint.copy(data, 44);
  destMint.copy(data, 76);
  tokenProg.copy(data, 108);
  vaultAuth.copy(data, 140);
  reserve.copy(data, 172);

  data.writeBigUInt64LE(12345n, 208);
  data.writeBigInt64LE(1_700_000_000n, 216);
  data.writeBigInt64LE(1_800_000_000n, 224);

  data.writeBigUInt64LE(1_000_000n, 232);
  const refund = PublicKey.unique();
  refund.toBuffer().copy(data, 240);
  data[272] = 1;

  const parsed = decodeMigrationConfig(data);

  assert.equal(parsed.version, MIGRATION_CONFIG_VERSION);
  assert.equal(parsed.bump, 7);
  assert.equal(parsed.vaultAuthorityBump, 8);
  assert.equal(parsed.paused, true);
  assert.ok(parsed.admin.equals(new PublicKey(admin)));
  assert.ok(parsed.sourceMint.equals(new PublicKey(sourceMint)));
  assert.ok(parsed.destinationMint.equals(new PublicKey(destMint)));
  assert.ok(parsed.tokenProgramId.equals(TOKEN_PROGRAM_ID));
  assert.ok(parsed.vaultAuthority.equals(new PublicKey(vaultAuth)));
  assert.ok(parsed.reserveVault.equals(new PublicKey(reserve)));
  assert.equal(parsed.totalMigrated, 12345n);
  assert.equal(parsed.startTs, 1_700_000_000n);
  assert.equal(parsed.endTs, 1_800_000_000n);
  assert.equal(parsed.migrationCap, 1_000_000n);
  assert.ok(parsed.refundRecipient.equals(refund));
  assert.equal(parsed.unclaimedWithdrawn, true);
});
