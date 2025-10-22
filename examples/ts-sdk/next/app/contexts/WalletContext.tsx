import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { UiWalletAccount, UiWallet } from "@wallet-standard/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import type { Address } from "@solana/kit";

interface ConnectedWallet {
  account: UiWalletAccount;
  wallet: UiWallet;
}

type WalletAdapter = ReturnType<typeof useWalletAccountTransactionSigner>;

interface WalletContextType {
  account: UiWalletAccount | null;
  wallet: UiWallet | null;
  connectedWallet: ConnectedWallet | null;
  setConnectedWallet: (wallet: ConnectedWallet | null) => void;
  isConnected: boolean;
  signer: WalletAdapter | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

function WalletProviderInner({
  children,
  connectedWallet,
  setConnectedWallet,
}: {
  children: ReactNode;
  connectedWallet: ConnectedWallet;
  setConnectedWallet: (wallet: ConnectedWallet | null) => void;
}) {
  const signer = useWalletAccountTransactionSigner(
    connectedWallet.account,
    "solana:devnet",
  );

  return (
    <WalletContext.Provider
      value={{
        account: connectedWallet.account,
        wallet: connectedWallet.wallet,
        connectedWallet,
        setConnectedWallet,
        isConnected: true,
        signer,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [connectedWallet, setConnectedWallet] =
    useState<ConnectedWallet | null>(null);

  if (connectedWallet) {
    return (
      <WalletProviderInner
        connectedWallet={connectedWallet}
        setConnectedWallet={setConnectedWallet}
      >
        {children}
      </WalletProviderInner>
    );
  }

  const value = {
    account: null,
    wallet: null,
    connectedWallet: null,
    setConnectedWallet,
    isConnected: false,
    signer: null,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
