import type { Mint } from "@solana/spl-token";
import { TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { BasicSupportedTypes, ParsableEntity } from "../../../src/web3";
import {
  ParsableMintInfo,
  ParsableTokenAccountInfo,
  SimpleAccountFetcher,
} from "../../../src/web3";
import type { TestContext } from "../../test-context";
import {
  createNewMint,
  createTestContext,
  requestAirdrop,
} from "../../test-context";
import { expectMintEquals } from "../../utils/expectations";

jest.setTimeout(100 * 1000 /* ms */);

describe("simple-account-fetcher", () => {
  let ctx: TestContext = createTestContext();
  const retentionPolicy = new Map<ParsableEntity<BasicSupportedTypes>, number>([
    [ParsableMintInfo, 1000],
    [ParsableTokenAccountInfo, 1000],
  ]);
  const testMints: PublicKey[] = [];

  beforeAll(async () => {
    await requestAirdrop(ctx);
    for (let i = 0; i < 10; i++) {
      testMints.push(await createNewMint(ctx, TOKEN_PROGRAM_ID));
    }
  });

  beforeEach(() => {
    ctx = createTestContext();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    // jest.resetAllMocks doesn't work (I guess that jest.spyOn rewrite prototype of Connection)
    jest.restoreAllMocks();
  });

  describe("getAccount", () => {
    it("fetch brand new account equals on-chain", async () => {
      const mintKey = testMints[0];

      const expected = await getMint(ctx.connection, mintKey);

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      const cached = await fetcher.getAccount(mintKey, ParsableMintInfo);

      expect(spy).toBeCalledTimes(1);
      expect(cached).toBeDefined();
      expectMintEquals(cached!, expected);
    });

    it("returns cached value within retention window", async () => {
      const mintKey = testMints[0];
      const expected = await getMint(ctx.connection, mintKey);
      const now = Date.now();
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      await fetcher.getAccount(mintKey, ParsableMintInfo, undefined, now);
      const cached = await fetcher.getAccount(
        mintKey,
        ParsableMintInfo,
        undefined,
        now + retention,
      );

      expect(spy).toBeCalledTimes(1);
      expect(cached).toBeDefined();
      expectMintEquals(cached!, expected);
    });

    it("fetch new value when call is outside of retention window", async () => {
      const mintKey = testMints[0];
      const expected = await getMint(ctx.connection, mintKey);
      const now = 32523523523;
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      await fetcher.getAccount(mintKey, ParsableMintInfo, undefined, now);
      const cached = await fetcher.getAccount(
        mintKey,
        ParsableMintInfo,
        undefined,
        now + retention + 1,
      );

      expect(spy).toBeCalledTimes(2);
      expect(cached).toBeDefined();
      expectMintEquals(cached!, expected);
    });

    it("getAccount - return cache value when call does not exceed custom ttl", async () => {
      const mintKey = testMints[0];
      const expected = await getMint(ctx.connection, mintKey);
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const ttl = 50;
      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      await fetcher.getAccount(mintKey, ParsableMintInfo, { maxAge: ttl }, now);
      const cached = await fetcher.getAccount(
        mintKey,
        ParsableMintInfo,
        { maxAge: ttl },
        now + ttl,
      );

      expect(spy).toBeCalledTimes(1);
      expect(cached).toBeDefined();
      expectMintEquals(cached!, expected);
    });

    it("fetch new value when call exceed custom ttl", async () => {
      const mintKey = testMints[0];
      const expected = await getMint(ctx.connection, mintKey);
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const ttl = 50;
      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      await fetcher.getAccount(mintKey, ParsableMintInfo, { maxAge: ttl }, now);
      const cached = await fetcher.getAccount(
        mintKey,
        ParsableMintInfo,
        { maxAge: ttl },
        now + ttl + 1,
      );

      expect(spy).toBeCalledTimes(2);
      expect(cached).toBeDefined();
      expectMintEquals(cached!, expected);
    });

    it("fetch new value when call ttl === 0", async () => {
      const mintKey = testMints[0];
      const expected = await getMint(ctx.connection, mintKey);
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, new Map());

      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      await fetcher.getAccount(mintKey, ParsableMintInfo, { maxAge: 0 }, now);
      const cached = await fetcher.getAccount(
        mintKey,
        ParsableMintInfo,
        { maxAge: 0 },
        now + 1,
      );

      expect(spy).toBeCalledTimes(2);
      expect(cached).toBeDefined();
      expectMintEquals(cached!, expected);
    });

    it("fetch new value when call retention === 0", async () => {
      const mintKey = testMints[0];
      const expected = await getMint(ctx.connection, mintKey);
      const now = 32523523523;
      const retentionPolicy = new Map<
        ParsableEntity<BasicSupportedTypes>,
        number
      >([[ParsableMintInfo, 0]]);

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      await fetcher.getAccount(mintKey, ParsableMintInfo, undefined, now);
      const cached = await fetcher.getAccount(
        mintKey,
        ParsableMintInfo,
        undefined,
        now + 1,
      );

      expect(spy).toBeCalledTimes(2);
      expect(cached).toBeDefined();
      expectMintEquals(cached!, expected);
    });

    it("fetching invalid account returns null", async () => {
      const mintKey = PublicKey.default;
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const cached = await fetcher.getAccount(
        mintKey,
        ParsableMintInfo,
        undefined,
        now,
      );

      expect(cached).toBeNull();
    });

    it("fetching valid account but invalid account type returns null", async () => {
      const mintKey = testMints[0];
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const cached = await fetcher.getAccount(
        mintKey,
        ParsableTokenAccountInfo,
        undefined,
        now,
      );

      expect(cached).toBeNull();
    });

    it("fetching null-cached accounts will respect ttl", async () => {
      const mintKey = testMints[0];
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getAccountInfo");
      await fetcher.getAccount(
        mintKey,
        ParsableTokenAccountInfo,
        undefined,
        now,
      );
      const cached = await fetcher.getAccount(
        mintKey,
        ParsableTokenAccountInfo,
        undefined,
        now + 5,
      );

      expect(spy).toBeCalledTimes(1);
      expect(cached).toBeNull();
    });
  });

  describe("getAccounts", () => {
    let expectedMintInfos: Mint[] = [];

    beforeAll(async () => {
      for (const mint of testMints) {
        expectedMintInfos.push(await getMint(ctx.connection, mint));
      }
    });

    it("nothing cached, fetching all values", async () => {
      const mintKeys = testMints;
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const resultMap = await fetcher.getAccounts(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now,
      );

      expect(spy).toBeCalledTimes(1);

      Array.from(resultMap.values()).forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("all are cached, fetching all values will not call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(mintKeys, ParsableMintInfo, undefined, now);
      const resultMap = await fetcher.getAccounts(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention,
      );
      expect(spy).toBeCalledTimes(1);
      Array.from(resultMap.values()).forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("all are cached but expired, fetching all values will call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(mintKeys, ParsableMintInfo, undefined, now);
      const resultMap = await fetcher.getAccounts(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention + 1,
      );
      expect(spy).toBeCalledTimes(2);
      Array.from(resultMap.values()).forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("some are cached, fetching all values will call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(
        [testMints[0], testMints[1]],
        ParsableMintInfo,
        undefined,
        now,
      );
      const resultMap = await fetcher.getAccounts(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention,
      );
      expect(spy).toBeCalledTimes(2);
      Array.from(resultMap.values()).forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("some are cached, some expired, fetching all values will call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(
        [testMints[0], testMints[1]],
        ParsableMintInfo,
        undefined,
        now,
      );
      await fetcher.getAccounts(
        [testMints[2], testMints[3]],
        ParsableMintInfo,
        undefined,
        now + 5,
      );
      const resultMap = await fetcher.getAccounts(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention + 1,
      );
      expect(spy).toBeCalledTimes(3);
      Array.from(resultMap.values()).forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("some are cached, some expired, some invalid", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(
        [testMints[0], testMints[1]],
        ParsableMintInfo,
        undefined,
        now,
      );
      await fetcher.getAccounts(
        [testMints[2], testMints[3], PublicKey.default],
        ParsableMintInfo,
        undefined,
        now + 5,
      );
      const resultMap = await fetcher.getAccounts(
        [...mintKeys, PublicKey.default],
        ParsableMintInfo,
        undefined,
        now + retention + 1,
      );
      expect(spy).toBeCalledTimes(3);
      Array.from(resultMap.values()).forEach((value, index) => {
        if (index <= mintKeys.length - 1) {
          expect(value).toBeDefined();
          expectMintEquals(value!, expectedMintInfos[index]);
        } else {
          // Expect the last value, which is invalid, to be null
          expect(value).toBeNull();
        }
      });
    });
  });

  describe("getAccountsAsArray", () => {
    let expectedMintInfos: Mint[] = [];

    beforeAll(async () => {
      for (const mint of testMints) {
        expectedMintInfos.push(await getMint(ctx.connection, mint));
      }
    });

    it("nothing cached, fetching all values", async () => {
      const mintKeys = testMints;
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const resultArray = await fetcher.getAccountsAsArray(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now,
      );

      expect(spy).toBeCalledTimes(1);

      resultArray.forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("duplicated values are shown", async () => {
      const mintKeys = [...testMints, ...testMints];
      const expected = [...expectedMintInfos, ...expectedMintInfos];
      const now = 32523523523;

      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const resultArray = await fetcher.getAccountsAsArray(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now,
      );

      expect(spy).toBeCalledTimes(1);

      resultArray.forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expected[index]);
      });
    });

    it("all are cached, fetching all values will not call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(mintKeys, ParsableMintInfo, undefined, now);
      const result = await fetcher.getAccountsAsArray(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention,
      );
      expect(spy).toBeCalledTimes(1);
      result.forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("all are cached but expired, fetching all values will call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(mintKeys, ParsableMintInfo, undefined, now);
      const result = await fetcher.getAccountsAsArray(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention + 1,
      );
      expect(spy).toBeCalledTimes(2);
      result.forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("some are cached, fetching all values will call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(
        [testMints[0], testMints[1]],
        ParsableMintInfo,
        undefined,
        now,
      );
      const result = await fetcher.getAccountsAsArray(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention,
      );
      expect(spy).toBeCalledTimes(2);
      result.forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("some are cached, some expired, fetching all values will call for update", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(
        [testMints[0], testMints[1]],
        ParsableMintInfo,
        undefined,
        now,
      );
      await fetcher.getAccounts(
        [testMints[2], testMints[3]],
        ParsableMintInfo,
        undefined,
        now + 5,
      );
      const result = await fetcher.getAccountsAsArray(
        mintKeys,
        ParsableMintInfo,
        undefined,
        now + retention + 1,
      );
      expect(spy).toBeCalledTimes(3);
      result.forEach((value, index) => {
        expect(value).toBeDefined();
        expectMintEquals(value!, expectedMintInfos[index]);
      });
    });

    it("some are cached, some expired, some invalid", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const retention = retentionPolicy.get(ParsableMintInfo)!;

      await fetcher.getAccounts(
        [testMints[0], testMints[1]],
        ParsableMintInfo,
        undefined,
        now,
      );
      await fetcher.getAccounts(
        [testMints[2], testMints[3], PublicKey.default],
        ParsableMintInfo,
        undefined,
        now + 5,
      );
      const result = await fetcher.getAccountsAsArray(
        [...mintKeys, PublicKey.default],
        ParsableMintInfo,
        undefined,
        now + retention + 1,
      );
      expect(spy).toBeCalledTimes(3);
      result.forEach((value, index) => {
        if (index <= mintKeys.length - 1) {
          expect(value).toBeDefined();
          expectMintEquals(value!, expectedMintInfos[index]);
        } else {
          // Expect the last value, which is invalid, to be null
          expect(value).toBeNull();
        }
      });
    });
  });

  describe("refreshAll", () => {
    it("refresh all updates all keys", async () => {
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const now = 32523523523;

      // Populate cache
      await fetcher.getAccounts(testMints, ParsableMintInfo, undefined, now);

      const spy = jest.spyOn(ctx.connection, "getMultipleAccountsInfo");
      const renewNow = now + 500000;
      await fetcher.refreshAll(renewNow);
      expect(spy).toBeCalledTimes(1);
      fetcher.cache.forEach((value, _) => {
        expect(value.fetchedAt).toEqual(renewNow);
      });
    });
  });

  describe.only("populateAccounts", () => {
    let expectedMintInfos: Mint[] = [];

    beforeAll(async () => {
      for (const mint of testMints) {
        expectedMintInfos.push(await getMint(ctx.connection, mint));
      }
    });

    it("populateAccounts updates all keys from empty state", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const other = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      const testSet = [mintKeys[0], mintKeys[1], mintKeys[2]];
      const otherFetched = await other.getAccounts(
        testSet,
        ParsableMintInfo,
        undefined,
        now,
      );

      // Populate the fetcher with prefetched accounts and fetch from the fetcher to see if the cached values are set
      fetcher.populateAccounts(otherFetched, ParsableMintInfo, now);
      const results = await fetcher.getAccountsAsArray(
        testSet,
        ParsableMintInfo,
        {
          maxAge: Number.POSITIVE_INFINITY,
        },
        now + 5,
      );

      results.forEach((value, index) => {
        expectMintEquals(value!, expectedMintInfos[index]);
      });
      fetcher.cache.forEach((value, _) => {
        expect(value.fetchedAt).toEqual(now);
      });
    });

    it("populateAccounts updates all keys from non-empty state", async () => {
      const mintKeys = testMints;
      const now = 32523523523;
      const fetcher = new SimpleAccountFetcher(ctx.connection, retentionPolicy);
      const other = new SimpleAccountFetcher(ctx.connection, retentionPolicy);

      await fetcher.getAccount(
        mintKeys[0],
        ParsableMintInfo,
        undefined,
        now - 5,
      );
      const testSet = [mintKeys[0], mintKeys[1], mintKeys[2]];
      const otherFetched = await other.getAccounts(
        testSet,
        ParsableMintInfo,
        undefined,
        now,
      );

      expect(fetcher.cache.size).toEqual(1);
      fetcher.cache.forEach((value, _) => {
        expect(value.fetchedAt).toEqual(now - 5);
      });

      // Populate the fetcher with prefetched accounts and fetch from the fetcher to see if the cached values are set
      fetcher.populateAccounts(otherFetched, ParsableMintInfo, now);
      const results = await fetcher.getAccountsAsArray(
        testSet,
        ParsableMintInfo,
        {
          maxAge: Number.POSITIVE_INFINITY,
        },
        now + 5,
      );

      results.forEach((value, index) => {
        expectMintEquals(value!, expectedMintInfos[index]);
      });

      fetcher.cache.forEach((value, _) => {
        expect(value.fetchedAt).toEqual(now);
      });
    });
  });
});
