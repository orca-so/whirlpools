import type { Address } from "@coral-xyz/anchor";
import type { PoolTokenPair } from "../../src";

export const solConnectedPools: PoolTokenPair[] = [
  {
    address: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
    tokenMintA: "So11111111111111111111111111111111111111112",
    tokenMintB: "RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a",
  },
  {
    address: "HQcY5n2zP6rW74fyFEhWeBd3LnJpBcZechkvJpmdb8cx",
    tokenMintA: "So11111111111111111111111111111111111111112",
    tokenMintB: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  },
  {
    address: "2AEWSvUds1wsufnsDPCXjFsJCMJH5SNNm7fSF4kxys9a",
    tokenMintA: "So11111111111111111111111111111111111111112",
    tokenMintB: "DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ",
  },
  {
    address: "CPsTfDvZYeVB5uTqQZcwwTTBJ7KPFvB6JKLGSWsFZEL7",
    tokenMintA: "So11111111111111111111111111111111111111112",
    tokenMintB: "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
  },
  {
    address: "HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",
    tokenMintA: "So11111111111111111111111111111111111111112",
    tokenMintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
];

export const usdcConnectedPools: PoolTokenPair[] = [
  {
    address: "7PNQ9rfSGCbCC3XTeL6CwwAzevqQGvKXeXMxP2TjS7rM",
    tokenMintA: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenMintB: "RLBxxFkseAZ4RgJH3Sqn8jXxhmGoz9jWxDNJMh8pL7a",
  },
  {
    address: "7A1R3L7AxcxuZHMJjFgskKGeBR5Rwst3Ai5bv5uAWZFG",
    tokenMintA: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenMintB: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  },
  {
    address: "BVXNG6BrL2Tn3NmppnMeXHjBHTaQSnSnLE99JKwZSWPg",
    tokenMintA: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenMintB: "DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ",
  },
];

export const oneRouteTwoHopsThroughSOL: [Address, Address] = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj",
];

export const feeTierPoolsGraphData: PoolTokenPair[] = [
  {
    address: "Gr7WKYBqRLt7oUkjZ54LSbiUf8EgNWcj3ogtN8dKbfeb",
    tokenMintA: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    tokenMintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  {
    address: "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
    tokenMintA: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    tokenMintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  {
    address: "67S6KLCtgFZmRYzy6dCDc1v754mmcpK33pZd7Hg2yeVj",
    tokenMintA: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    tokenMintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
];

export const oneRouteTwoHopsThroughmSOL: [Address, Address] = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
];

export const uniqueTokenMintsGraphData: PoolTokenPair[] = [
  {
    address: "5Z66YYYaTmmx1R4mATAGLSc8aV4Vfy5tNdJQzk1GP9RF",
    tokenMintA: "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
    tokenMintB: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  },
];

export const uniqueTokenMintsGraphTokenUnsortedData: PoolTokenPair[] = [
  {
    address: "5Z66YYYaTmmx1R4mATAGLSc8aV4Vfy5tNdJQzk1GP9RF",
    tokenMintA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
    tokenMintB: "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
  },
];
