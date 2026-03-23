import test from "node:test";
import assert from "node:assert/strict";

import {
  MINT_LEN,
  PROGRAMDATA_DISCRIMINATOR,
  PROGRAMDATA_METADATA_LEN,
  TOKEN_ACCOUNT_LEN,
  parseMintData,
  parseProgramData,
  parseTokenAccountData,
} from "./releaseUtils.ts";

test("parseMintData enforces strict mint length and fields", () => {
  const data = Buffer.alloc(MINT_LEN);
  data.writeUInt32LE(0, 0);
  data.writeBigUInt64LE(1234n, 36);
  data[44] = 9;
  data[45] = 1;
  data.writeUInt32LE(0, 46);

  assert.deepEqual(parseMintData(data), {
    mintAuthorityOption: 0,
    supply: 1234n,
    decimals: 9,
    isInitialized: true,
    freezeAuthorityOption: 0,
  });
  assert.throws(() => parseMintData(Buffer.alloc(MINT_LEN - 1)));
});

test("parseTokenAccountData enforces strict token-account length and fields", () => {
  const data = Buffer.alloc(TOKEN_ACCOUNT_LEN);
  const mint = Buffer.alloc(32, 0x11);
  const owner = Buffer.alloc(32, 0x22);
  mint.copy(data, 0);
  owner.copy(data, 32);
  data.writeBigUInt64LE(987n, 64);
  data.writeUInt32LE(0, 72);
  data[108] = 1;
  data.writeBigUInt64LE(0n, 121);
  data.writeUInt32LE(0, 129);

  const parsed = parseTokenAccountData(data);
  assert.equal(parsed.amount, 987n);
  assert.equal(parsed.state, 1);
  assert.equal(parsed.delegateOption, 0);
  assert.equal(parsed.delegatedAmount, 0n);
  assert.equal(parsed.closeAuthorityOption, 0);
  assert.throws(() => parseTokenAccountData(Buffer.alloc(TOKEN_ACCOUNT_LEN - 1)));
});

test("parseProgramData enforces metadata length and authority decoding", () => {
  const data = Buffer.alloc(PROGRAMDATA_METADATA_LEN);
  const authority = Buffer.alloc(32, 0x33);
  data.writeUInt32LE(PROGRAMDATA_DISCRIMINATOR, 0);
  data[12] = 1;
  authority.copy(data, 13);

  const parsed = parseProgramData(data);
  assert.equal(parsed.stateDiscriminator, PROGRAMDATA_DISCRIMINATOR);
  assert.equal(parsed.authorityOption, 1);
  assert.match(parsed.authority ?? "", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.throws(() => parseProgramData(Buffer.alloc(PROGRAMDATA_METADATA_LEN - 1)));
});
