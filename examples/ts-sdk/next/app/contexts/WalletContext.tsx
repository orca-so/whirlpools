import { createContext, useContext, useState, useMemo } from "react";
import type { ReactNode } from "react";
import type { UiWalletAccount, UiWallet } from "@wallet-standard/react";
import { useWalletAccountMessageSigner, useWalletAccountTransactionSigner } from "@solana/react";
import type { MessagePartialSigner, TransactionPartialSigner } from "@solana/kit";

interface ConnectedWallet {
  account: UiWalletAccount;
  wallet: UiWallet;
}

type CompositeSigner = MessagePartialSigner & TransactionPartialSigner;

interface WalletContextType {
  account: UiWalletAccount | null;
  wallet: UiWallet | null;
  connectedWallet: ConnectedWallet | null;
  setConnectedWallet: (wallet: ConnectedWallet | null) => void;
  isConnected: boolean;
  signer: CompositeSigner | null;
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
  const messageSigner = useWalletAccountMessageSigner(
    connectedWallet.account,
  );
  const transactionSigner = useWalletAccountTransactionSigner(
    connectedWallet.account,
    "solana:devnet", // Use the appropriate chain
  );

  // Combine both signers into a composite signer that implements both interfaces
  const signer = useMemo<CompositeSigner>(() => ({
    address: messageSigner.address,
    // MessagePartialSigner: Return signature dictionaries from signed messages
    signMessages: async (messages) => {
      const signedMessages = await messageSigner.modifyAndSignMessages(messages);
      return signedMessages.map(msg => {
        // Filter out null signatures
        const filtered: Record<string, Uint8Array> = {};
        for (const [addr, sig] of Object.entries(msg.signatures)) {
          if (sig !== null) {
            filtered[addr] = sig;
          }
        }
        return filtered as any;
      });
    },
    // TransactionPartialSigner: Return signature dictionaries from signed transactions
    signTransactions: async (transactions) => {
      const signedTransactions = await transactionSigner.modifyAndSignTransactions(transactions);
      return signedTransactions.map(tx => {
        // Filter out null signatures
        const filtered: Record<string, Uint8Array> = {};
        for (const [addr, sig] of Object.entries(tx.signatures)) {
          if (sig !== null) {
            filtered[addr] = sig;
          }
        }
        return filtered as any;
      });
    },
  }), [messageSigner, transactionSigner]);

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
