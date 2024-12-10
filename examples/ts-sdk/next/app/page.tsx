"use client";
import { fetchPositionsForOwner, PositionOrBundle } from "@orca-so/whirlpools";
import { tickIndexToSqrtPrice } from "@orca-so/whirlpools-core";
import { useCallback, useMemo, useState } from "react";
import { createSolanaRpc, mainnet, address, devnet } from "@solana/web3.js";

export default function Page() {
  const [positions, setPositions] = useState<PositionOrBundle[]>([]);
  const [owner, setOwner] = useState<string>("");
  const [tickIndex, setTickIndex] = useState<string>("");
  const [sqrtPrice, setSqrtPrice] = useState<bigint>();

  const rpc = useMemo(() => {
    if (!process.env.NEXT_PUBLIC_RPC_URL) {
      console.error("NEXT_PUBLIC_RPC_URL is not set");
      return createSolanaRpc(devnet("https://api.devnet.solana.com"));
    }
    return createSolanaRpc(mainnet(process.env.NEXT_PUBLIC_RPC_URL));
  }, [process.env.NEXT_PUBLIC_RPC_URL]);

  const fetchPositions = useCallback(async () => {
    const positions = await fetchPositionsForOwner(rpc, address(owner));
    setPositions(positions);
  }, [owner]);

  const convertTickIndex = useCallback(() => {
    const index = parseInt(tickIndex);
    setSqrtPrice(tickIndexToSqrtPrice(index));
  }, [tickIndex]);

  return (
    <div>
      <p>
        <input
          type="number"
          value={tickIndex}
          onChange={(e) => setTickIndex(e.target.value)}
        />{" "}
        <button onClick={() => convertTickIndex()}>Convert</button>{" "}
        {sqrtPrice !== undefined && <>Sqrt Price: {sqrtPrice.toString()}</>}
      </p>
      <p>
        <input
          type="text"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />{" "}
        <button onClick={() => fetchPositions()}>Fetch Positions</button>{" "}
        {positions.length > 0 && <>{positions.length} positions found</>}
      </p>
    </div>
  );
}
