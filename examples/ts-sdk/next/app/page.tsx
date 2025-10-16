"use client";

import { swapInstructions, setWhirlpoolsConfig } from "@orca-so/whirlpools";
import { useWallet } from "./contexts/WalletContext";
import { useState, useEffect, useMemo } from "react";
import { WalletProvider } from "./contexts/WalletContext";
import { ConnectWalletButton } from "./components/ConnectWalletButton";
import { cn } from "@/lib/utils";
import {
  createSolanaRpc,
  address,
  Address,
} from "@solana/kit";
import { buildAndSendTransaction, buildTransaction, sendTransaction, setRpc } from "@orca-so/tx-sender";

const SOL_MINT: Address = address(
  "So11111111111111111111111111111111111111112",
);
const POOL_ADDRESS: Address = address(
  "Bz7wxD47Y1pDQNAmT6SejSETj6o8SneWMUaFXERDB1fr",
);

interface SwapPageProps {
  account: NonNullable<ReturnType<typeof useWallet>["account"]>;
}

function SwapPage({ account }: SwapPageProps) {
  const { signer } = useWallet();
  const [transactionStatus, setTransactionStatus] = useState<string>("");
  const [isSwapping, setIsSwapping] = useState(false);
  const [solscanLink, setSolscanLink] = useState<string | null>(null);

  const rpc = useMemo(
    () => createSolanaRpc(process.env.NEXT_PUBLIC_RPC_URL! || "https://api.devnet.solana.com"),
    [],
  );

  const handleSwap = async () => {
    if (!account || !signer) {
      alert("Please connect wallet");
      return;
    }

    setIsSwapping(true);
    setSolscanLink(null);
    setTransactionStatus("Creating swap transaction...");
    const { instructions } = await swapInstructions(
      rpc,
      {
        inputAmount: 100_000_000n,
        mint: SOL_MINT,
      },
      POOL_ADDRESS,
      100,
      signer,
    );

    try {
      setTransactionStatus("Signing and sending transaction...");
      const signature = await buildAndSendTransaction(instructions, signer);
      setTransactionStatus("finalized");
      setSolscanLink(`https://solscan.io/tx/${signature}?cluster=devnet`);
    } catch (error) {
      console.error("Swap failed:", error);
      setTransactionStatus(
        `Transaction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: "600px",
        margin: "0 auto",
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: "700",
            color: "#111827",
            margin: "0 0 8px 0",
          }}
        >
          Buy devUSDC
        </h1>
        <p style={{ color: "#6b7280", margin: 0 }}>
          Executes a single swap of 0.1 SOL → devUSDC
        </p>
      </div>

      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "24px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
        }}
      >
        <button
          onClick={handleSwap}
          disabled={!account || isSwapping}
          className={cn(
            "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
            "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400",
            "h-11 rounded-md px-8 w-full",
          )}
        >
          {isSwapping
            ? "Swapping..."
            : !account
              ? "Connect Wallet"
              : "Buy devUSDC for 0.1 SOL"}
        </button>

        {transactionStatus && (
          <div
            style={{
              marginTop: "16px",
              padding: "16px",
              borderRadius: "8px",
              backgroundColor: transactionStatus.includes("failed")
                ? "#fef2f2"
                : "#eff6ff",
              border: transactionStatus.includes("failed")
                ? "1px solid #fca5a5"
                : "1px solid #93c5fd",
              color: transactionStatus.includes("failed")
                ? "#b91c1c"
                : "#1d4ed8",
            }}
          >
            {transactionStatus === "finalized" && solscanLink ? (
              <span>
                Confirmed! View details on{" "}
                <a
                  href={solscanLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: "underline" }}
                >
                  Solscan
                </a>
              </span>
            ) : (
              transactionStatus
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PageContent() {
  const { account } = useWallet();

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f9fafb",
        padding: "32px 24px",
      }}
    >
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "32px",
          }}
        >
          <ConnectWalletButton />
        </div>
        {account ? (
          <SwapPage account={account} />
        ) : (
          <div style={{ textAlign: "center", marginTop: "48px" }}>
            <p style={{ color: "#6b7280", fontSize: "18px" }}>
              Please connect your wallet to start trading
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  useEffect(() => {
    setWhirlpoolsConfig("solanaDevnet");
    setRpc(process.env.NEXT_PUBLIC_RPC_URL! || "https://api.devnet.solana.com");
  }, []);

  return (
    <WalletProvider>
      <PageContent />
    </WalletProvider>
  );
}
