"use client";

import { useState } from "react";
import { useWallets } from "@wallet-standard/react";
import { useWallet } from "../contexts/WalletContext";
import { Button } from "./ui/button";
import { WalletListModal } from "./WalletListModal";

export function ConnectWalletButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const wallets = useWallets();
  const { account, isConnected } = useWallet();

  const solanaWallets = wallets.filter((wallet) =>
    wallet.chains.some((chain) => chain.startsWith("solana:"))
  );

  if (isConnected && account) {
    return (
      <div className="wallet-connected">
        <div className="status-dot"></div>
        <span className="wallet-address">
          {account.address.slice(0, 4)}...{account.address.slice(-4)}
        </span>
      </div>
    );
  }

  return (
    <>
      <Button onClick={() => setIsModalOpen(true)}>Connect Wallet</Button>
      <WalletListModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        wallets={solanaWallets}
      />
    </>
  );
}