"use client";

import {
  useConnect,
  useDisconnect,
  type UiWallet,
} from "@wallet-standard/react";
import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useWallet } from "../contexts/WalletContext";
  
  interface WalletListModalProps {
    isOpen: boolean;
    onClose: () => void;
    wallets: UiWallet[];
  }
  
  export function WalletListModal({
    isOpen,
    onClose,
    wallets,
  }: WalletListModalProps) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Wallet</DialogTitle>
          </DialogHeader>
          <DialogDescription>Select a wallet to connect to.</DialogDescription>
          <div className="flex flex-col gap-2">
            {wallets.map((wallet) => (
              <WalletListItem
                key={wallet.name}
                wallet={wallet}
                onConnect={onClose}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  
  interface WalletItemProps {
    wallet: UiWallet;
    onConnect?: () => void;
  }
  
export const WalletListItem = ({ wallet, onConnect }: WalletItemProps) => {
  const [isConnecting, connect] = useConnect(wallet);
  const [isDisconnecting, disconnect] = useDisconnect(wallet);
  const { setConnectedWallet, isConnected } = useWallet();

  useEffect(() => {
    if (isDisconnecting) {
      setConnectedWallet(null);
    }
  }, [isDisconnecting, setConnectedWallet]);

  const handleConnect = async () => {
    try {
      const connectedAccount = await connect();
      if (!connectedAccount.length) {
        console.warn(`Connect to ${wallet.name} but there are no accounts.`);
        return connectedAccount;
      }

      const first = connectedAccount[0];
      setConnectedWallet({ account: first, wallet });
      onConnect?.(); // Close modal after successful connection
      return connectedAccount;
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  };

  return (
    <button
      className="wallet-item"
      onClick={isConnected ? disconnect : handleConnect}
      disabled={isConnecting}
    >
      {wallet.icon ? (
        <img
          src={wallet.icon}
          alt={wallet.name}
          className="wallet-icon"
        />
      ) : (
        <div className="wallet-icon-fallback">
          <span>
            {wallet.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div className="wallet-info">
        <div className="wallet-name">
          {isConnecting ? "Connecting..." : wallet.name}
        </div>
        <div className="wallet-status">
          {isConnecting ? "Please wait..." : "Click to connect"}
        </div>
      </div>
      {isConnecting && (
        <div className="spinner" />
      )}
    </button>
  );
};