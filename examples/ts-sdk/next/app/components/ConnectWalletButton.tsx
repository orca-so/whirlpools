"use client";

import { useState } from "react";
import { useWallets } from "@wallet-standard/react";
import { useWallet } from "../contexts/WalletContext";
import { WalletListModal } from "./WalletListModal";
import { cn } from "@/lib/utils";

export function ConnectWalletButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const wallets = useWallets();
  const { account, isConnected } = useWallet();

  const solanaWallets = wallets.filter((wallet) =>
    wallet.chains.some((chain) => chain.startsWith("solana:")),
  );

  if (isConnected && account) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        <span className="font-mono text-sm">
          {account.address.slice(0, 4)}...{account.address.slice(-4)}
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          "bg-blue-600 text-white hover:bg-blue-700",
          "h-10 px-4 py-2",
        )}
      >
        Connect Wallet
      </button>
      <WalletListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        wallets={solanaWallets}
      />
    </>
  );
}
