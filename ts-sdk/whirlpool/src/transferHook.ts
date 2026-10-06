import type { Mint } from "@solana-program/token-2022";
import type { Address, GetAccountInfoApi, Rpc } from "@solana/kit";
import {
  AccountRole,
  fetchEncodedAccount,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { DEFAULT_ADDRESS } from "./config";
import type { RemainingAccount } from "./remainingAccounts";

const EXTRA_ACCOUNT_METAS_SEED = "extra-account-metas";
const EXECUTE_DISCRIMINATOR = new Uint8Array([
  105, 37, 101, 197, 75, 251, 102, 26,
]);
const EXTRA_ACCOUNT_META_SPAN = 35;

function roleFromFlags(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner && isWritable) {
    return AccountRole.WRITABLE_SIGNER;
  }
  if (isSigner) {
    return AccountRole.READONLY_SIGNER;
  }
  if (isWritable) {
    return AccountRole.WRITABLE;
  }
  return AccountRole.READONLY;
}

function flagsFromRole(role: AccountRole): {
  isSigner: boolean;
  isWritable: boolean;
} {
  return {
    isSigner:
      role === AccountRole.READONLY_SIGNER ||
      role === AccountRole.WRITABLE_SIGNER,
    isWritable:
      role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER,
  };
}

function deEscalateAccountMeta(
  accountMeta: RemainingAccount,
  accountMetas: RemainingAccount[],
): RemainingAccount {
  const maybeHighestPrivileges = accountMetas
    .filter((x) => x.address === accountMeta.address)
    .reduce<{ isSigner: boolean; isWritable: boolean } | undefined>(
      (acc, x) => {
        const flags = flagsFromRole(x.role);
        if (!acc) {
          return flags;
        }
        return {
          isSigner: acc.isSigner || flags.isSigner,
          isWritable: acc.isWritable || flags.isWritable,
        };
      },
      undefined,
    );
  if (!maybeHighestPrivileges) {
    return accountMeta;
  }
  const flags = flagsFromRole(accountMeta.role);
  if (!maybeHighestPrivileges.isSigner && flags.isSigner) {
    flags.isSigner = false;
  }
  if (!maybeHighestPrivileges.isWritable && flags.isWritable) {
    flags.isWritable = false;
  }
  return {
    address: accountMeta.address,
    role: roleFromFlags(flags.isSigner, flags.isWritable),
  };
}

export function getTransferHookProgramId(mint: Mint): Address | undefined {
  if (mint.extensions.__option === "None") {
    return undefined;
  }
  for (const extension of mint.extensions.value) {
    if (extension.__kind === "TransferHook") {
      if (extension.programId === DEFAULT_ADDRESS) {
        return undefined;
      }
      return extension.programId;
    }
  }
  return undefined;
}

export async function getExtraAccountMetaAddress(
  mint: Address,
  hookProgram: Address,
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: hookProgram,
    seeds: [EXTRA_ACCOUNT_METAS_SEED, getAddressEncoder().encode(mint)],
  });
  return pda;
}

/**
 * Resolve transfer-hook extra accounts for a Token-2022 mint.
 * Matches SPL `addExtraAccountMetasForExecute` (amount 0, same as the legacy SDK).
 */
export async function getExtraAccountMetasForTransferHook(
  rpc: Rpc<GetAccountInfoApi>,
  mint: { address: Address; data: Mint },
  source: Address,
  destination: Address,
  owner: Address,
): Promise<RemainingAccount[] | undefined> {
  const hookProgram = getTransferHookProgramId(mint.data);
  if (!hookProgram) {
    return undefined;
  }

  const extraAccountMetaAddress = await getExtraAccountMetaAddress(
    mint.address,
    hookProgram,
  );
  const extraAccountMetaList = await fetchEncodedAccount(
    rpc,
    extraAccountMetaAddress,
  );
  if (!extraAccountMetaList.exists) {
    return undefined;
  }

  const executeKeys: RemainingAccount[] = [
    { address: source, role: AccountRole.READONLY },
    { address: mint.address, role: AccountRole.READONLY },
    { address: destination, role: AccountRole.READONLY },
    { address: owner, role: AccountRole.READONLY },
    { address: extraAccountMetaAddress, role: AccountRole.READONLY },
  ];

  const executeData = new Uint8Array(16);
  executeData.set(EXECUTE_DISCRIMINATOR, 0);

  const extraMetas = unpackExtraAccountMetas(extraAccountMetaList.data);
  for (const extraMeta of extraMetas) {
    executeKeys.push(
      deEscalateAccountMeta(
        await resolveExtraAccountMeta(
          rpc,
          extraMeta,
          executeKeys,
          executeData,
          hookProgram,
        ),
        executeKeys,
      ),
    );
  }

  return [
    ...executeKeys.slice(5),
    { address: hookProgram, role: AccountRole.READONLY },
    { address: extraAccountMetaAddress, role: AccountRole.READONLY },
  ];
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset]! |
      (data[offset + 1]! << 8) |
      (data[offset + 2]! << 16) |
      (data[offset + 3]! << 24)) >>>
    0
  );
}

type PackedExtraAccountMeta = {
  discriminator: number;
  addressConfig: Uint8Array;
  isSigner: boolean;
  isWritable: boolean;
};

function unpackExtraAccountMetas(data: Uint8Array): PackedExtraAccountMeta[] {
  // u64 discriminator, u32 length, u32 count, then ExtraAccountMeta entries
  const count = readU32LE(data, 12);
  const metas: PackedExtraAccountMeta[] = [];
  let offset = 16;
  for (let i = 0; i < count; i++) {
    metas.push({
      discriminator: data[offset]!,
      addressConfig: data.slice(offset + 1, offset + 33),
      isSigner: data[offset + 33] !== 0,
      isWritable: data[offset + 34] !== 0,
    });
    offset += EXTRA_ACCOUNT_META_SPAN;
  }
  return metas;
}

async function resolveExtraAccountMeta(
  rpc: Rpc<GetAccountInfoApi>,
  extraMeta: PackedExtraAccountMeta,
  previousMetas: RemainingAccount[],
  instructionData: Uint8Array,
  transferHookProgramId: Address,
): Promise<RemainingAccount> {
  if (extraMeta.discriminator === 0) {
    return {
      address: getAddressDecoder().decode(extraMeta.addressConfig),
      role: roleFromFlags(extraMeta.isSigner, extraMeta.isWritable),
    };
  }

  if (extraMeta.discriminator === 2) {
    const pubkey = await unpackPubkeyData(
      rpc,
      extraMeta.addressConfig,
      previousMetas,
      instructionData,
    );
    return {
      address: pubkey,
      role: roleFromFlags(extraMeta.isSigner, extraMeta.isWritable),
    };
  }

  let programId = transferHookProgramId;
  if (extraMeta.discriminator !== 1) {
    const accountIndex = extraMeta.discriminator - (1 << 7);
    const previous = previousMetas[accountIndex];
    if (!previous) {
      throw new Error("Transfer hook extra account meta is missing");
    }
    programId = previous.address;
  }

  const seeds = await unpackSeeds(
    rpc,
    extraMeta.addressConfig,
    previousMetas,
    instructionData,
  );
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds,
  });
  return {
    address: pda,
    role: roleFromFlags(extraMeta.isSigner, extraMeta.isWritable),
  };
}

async function unpackPubkeyData(
  rpc: Rpc<GetAccountInfoApi>,
  keyDataConfig: Uint8Array,
  previousMetas: RemainingAccount[],
  instructionData: Uint8Array,
): Promise<Address> {
  const discriminator = keyDataConfig[0];
  if (discriminator === 1) {
    const dataIndex = keyDataConfig[1]!;
    return getAddressDecoder().decode(
      instructionData.subarray(dataIndex, dataIndex + 32),
    );
  }
  if (discriminator === 2) {
    const accountIndex = keyDataConfig[1]!;
    const dataIndex = keyDataConfig[2]!;
    const previous = previousMetas[accountIndex];
    if (!previous) {
      throw new Error("Transfer hook extra account meta is missing");
    }
    const account = await fetchEncodedAccount(rpc, previous.address);
    if (!account.exists) {
      throw new Error("Transfer hook extra account data not found");
    }
    return getAddressDecoder().decode(
      account.data.subarray(dataIndex, dataIndex + 32),
    );
  }
  throw new Error("Invalid transfer hook pubkey data");
}

async function unpackSeeds(
  rpc: Rpc<GetAccountInfoApi>,
  packed: Uint8Array,
  previousMetas: RemainingAccount[],
  instructionData: Uint8Array,
): Promise<Uint8Array[]> {
  const seeds: Uint8Array[] = [];
  let i = 0;
  while (i < packed.length) {
    const unpacked = await unpackFirstSeed(
      rpc,
      packed.subarray(i),
      previousMetas,
      instructionData,
    );
    if (unpacked == null) {
      break;
    }
    seeds.push(unpacked.data);
    i += unpacked.packedLength;
  }
  return seeds;
}

async function unpackFirstSeed(
  rpc: Rpc<GetAccountInfoApi>,
  seeds: Uint8Array,
  previousMetas: RemainingAccount[],
  instructionData: Uint8Array,
): Promise<{ data: Uint8Array; packedLength: number } | null> {
  if (seeds.length === 0) {
    return null;
  }
  const discriminator = seeds[0]!;
  const remaining = seeds.subarray(1);
  switch (discriminator) {
    case 0:
      return null;
    case 1: {
      const length = remaining[0]!;
      return {
        data: remaining.subarray(1, 1 + length),
        packedLength: 2 + length,
      };
    }
    case 2: {
      const index = remaining[0]!;
      const length = remaining[1]!;
      return {
        data: instructionData.subarray(index, index + length),
        packedLength: 3,
      };
    }
    case 3: {
      const index = remaining[0]!;
      const previous = previousMetas[index];
      if (!previous) {
        throw new Error("Transfer hook extra account meta is missing");
      }
      return {
        data: new Uint8Array(getAddressEncoder().encode(previous.address)),
        packedLength: 2,
      };
    }
    case 4: {
      const accountIndex = remaining[0]!;
      const dataIndex = remaining[1]!;
      const length = remaining[2]!;
      const previous = previousMetas[accountIndex];
      if (!previous) {
        throw new Error("Transfer hook extra account meta is missing");
      }
      const account = await fetchEncodedAccount(rpc, previous.address);
      if (!account.exists) {
        throw new Error("Transfer hook extra account data not found");
      }
      return {
        data: account.data.subarray(dataIndex, dataIndex + length),
        packedLength: 4,
      };
    }
    default:
      throw new Error("Invalid transfer hook seed");
  }
}
