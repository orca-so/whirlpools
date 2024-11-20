"use client";
import { fetchPositionsForOwner, PositionOrBundle } from "@orca-so/whirlpools";
import { useCallback, useMemo, useState } from "react";
import { createSolanaRpc, mainnet, address } from "@solana/web3.js";

export default function Page() {
  const [positions, setPositions] = useState<PositionOrBundle[]>([]);
  const [loading, setLoading] = useState(false);
  const [owner, setOwner] = useState<string>("");

  const rpc = useMemo(() => {
    if (!process.env.NEXT_PUBLIC_RPC_URL) {
      throw new Error("NEXT_PUBLIC_RPC_URL is not set");
    }
    return createSolanaRpc(mainnet(process.env.NEXT_PUBLIC_RPC_URL));
  }, [process.env.NEXT_PUBLIC_RPC_URL]);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    const positions = await fetchPositionsForOwner(rpc, address(owner));
    setPositions(positions);
    setLoading(false);
  }, [owner]);

  return (
    <div>
      <input
        type="text"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
      />
      <button onClick={() => fetchPositions()}>Fetch Positions</button>
      {loading && <p>Loading...</p>}
      {positions.length > 0 && <p>{positions.length} positions found</p>}
    </div>
  );
}
