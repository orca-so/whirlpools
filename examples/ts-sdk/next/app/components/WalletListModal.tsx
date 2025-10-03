"use client";

import {
  useConnect,
  useDisconnect,
  type UiWallet,
} from "@wallet-standard/react";
import { useEffect } from "react";
import { useWallet } from "../contexts/WalletContext";
import { cn } from "@/lib/utils";

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
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />

      {/* Modal Content */}
      <div
        className={cn(
          "relative z-50 w-full max-w-lg m-4 bg-white p-6 shadow-lg duration-200",
          "border border-gray-200 rounded-lg",
          "animate-in",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
              fill="currentColor"
              fillRule="evenodd"
              clipRule="evenodd"
            />
          </svg>
          <span className="sr-only">Close</span>
        </button>

        {/* Header */}
        <div className="flex flex-col space-y-1.5 text-center sm:text-left mb-4">
          <h3 className="text-lg font-semibold leading-none tracking-tight text-gray-900">
            Connect Wallet
          </h3>
          <p className="text-sm text-gray-600">
            Select a wallet to connect to.
          </p>
        </div>

        {/* Wallet List */}
        <div className="grid gap-2">
          {wallets.map((wallet) => (
            <WalletListItem
              key={wallet.name}
              wallet={wallet}
              onConnect={onClose}
            />
          ))}
        </div>
      </div>
    </div>
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
      return [];
    }
  };

  return (
    <button
      className="flex items-center justify-between w-full p-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={isConnected ? disconnect : handleConnect}
      disabled={isConnecting}
    >
      <div className="flex items-center gap-3">
        {wallet.icon ? (
          <img
            src={wallet.icon}
            alt={wallet.name}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <span className="text-sm font-medium text-gray-600">
              {wallet.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="text-left">
          <div className="font-medium text-gray-900">
            {isConnecting ? "Connecting..." : wallet.name}
          </div>
          <div className="text-sm text-gray-500">
            {isConnecting ? "Please wait..." : "Click to connect"}
          </div>
        </div>
      </div>
      {isConnecting && (
        <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      )}
    </button>
  );
};
