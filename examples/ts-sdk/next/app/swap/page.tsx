"use client";

import {
  fetchWhirlpoolsByTokenPair,
  swapInstructions,
  setWhirlpoolsConfig
} from "@orca-so/whirlpools";
import { useWallet } from "../contexts/WalletContext";
import { useCallback, useState, useEffect, useMemo } from "react";
import { WalletProvider } from "../contexts/WalletContext";
import { ConnectWalletButton } from "../components/ConnectWalletButton";
import { cn } from "@/lib/utils";
import {
  createSolanaRpc,
  address,
  Address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signAndSendTransactionMessageWithSigners,
  getBase58Decoder,
} from "@solana/kit";
import { fetchToken, findAssociatedTokenPda } from "@solana-program/token-2022";

const SOL_MINT: Address = address("So11111111111111111111111111111111111111112");
const USDC_MINT: Address = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

type TokenBalance = {
  amount: bigint;
  decimals: number;
};

interface SwapPageProps {
  account: NonNullable<ReturnType<typeof useWallet>['account']>;
}

function SwapPage({ account }: SwapPageProps) {
  const { signer } = useWallet();
  const [solBalance, setSolBalance] = useState<TokenBalance>({ amount: 0n, decimals: 9 });
  const [usdcBalance, setUsdcBalance] = useState<TokenBalance>({ amount: 0n, decimals: 6 });
  const [inputAmount, setInputAmount] = useState<string>("");
  const [isSwappingAToB, setIsSwappingAToB] = useState(true);
  const [quote, setQuote] = useState<any>(null);
  const [poolInfo, setPoolInfo] = useState<any>(null);
  const [transactionStatus, setTransactionStatus] = useState<string>("");
  const [isSwapping, setIsSwapping] = useState(false);

  // Solana RPC connection
  const rpc = useMemo(() =>
    createSolanaRpc(process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com"),
    []
  );
  
  // Configure Whirlpools SDK for mainnet
  useEffect(() => {
    setWhirlpoolsConfig('solanaMainnet');
  }, []);

  // Load wallet token balances
  const fetchBalances = useCallback(async () => {
    if (!account) {
      setSolBalance({ amount: 0n, decimals: 9 });
      setUsdcBalance({ amount: 0n, decimals: 6 });
      return;
    }

    try {
      const walletAddress = address(account.address);

      const solBalanceResult = await rpc.getBalance(walletAddress).send();
      setSolBalance({ amount: solBalanceResult.value, decimals: 9 });

      try {
        const [usdcTokenAccount] = await findAssociatedTokenPda({
          mint: USDC_MINT as any,
          owner: walletAddress as any,
          tokenProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") as any
        });
        const usdcAccountInfo = await fetchToken(rpc as any, usdcTokenAccount);
        setUsdcBalance({
          amount: usdcAccountInfo.data.amount,
          decimals: 6
        });
      } catch (error) {
        setUsdcBalance({ amount: 0n, decimals: 6 });
      }
    } catch (error) {
      console.error("Failed to fetch balances:", error);
      setSolBalance({ amount: 0n, decimals: 9 });
      setUsdcBalance({ amount: 0n, decimals: 6 });
    }
  }, [account, rpc]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // Get swap quote with input debouncing
  useEffect(() => {
    if (!inputAmount || isNaN(parseFloat(inputAmount)) || !account) {
      setQuote(null);
      setPoolInfo(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const pools = await fetchWhirlpoolsByTokenPair(rpc as any, SOL_MINT as any, USDC_MINT as any);
        const targetPool = pools.find(pool => pool.initialized && pool.tickSpacing === 64);

        if (!targetPool) {
          console.error("No 0.16% fee tier pool found");
          return;
        }

        setPoolInfo(targetPool);

        const inputAmountBN = isSwappingAToB
          ? BigInt(Math.floor(parseFloat(inputAmount) * 10 ** 9))
          : BigInt(Math.floor(parseFloat(inputAmount) * 10 ** 6));

        const quoteResult = await swapInstructions(
          rpc as any,
          {
            inputAmount: inputAmountBN,
            mint: (isSwappingAToB ? SOL_MINT : USDC_MINT) as any
          },
          targetPool.address,
          100,
          signer as any
        );

        setQuote(quoteResult);
      } catch (error) {
        console.error("Failed to fetch quote:", error);
        setQuote(null);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [inputAmount, isSwappingAToB, rpc, account, signer]);

  const handleSwap = async () => {
    if (!account || !quote || !poolInfo || !signer) {
      alert("Please connect wallet and get a quote first");
      return;
    }

    setIsSwapping(true);
    setTransactionStatus("Creating swap transaction...");

    try {
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

      // Build transaction with swap instructions
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        m => setTransactionMessageFeePayerSigner(signer, m),
        m => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        m => appendTransactionMessageInstructions(quote.instructions, m),
      );

      setTransactionStatus("Signing and sending transaction...");

      const signatureBytes = await signAndSendTransactionMessageWithSigners(message);
      const signature = getBase58Decoder().decode(signatureBytes);

      setTransactionStatus(`Transaction sent! Signature: ${signature.slice(0, 8)}...${signature.slice(-8)}`);

      // Reset form and update balances
      setInputAmount("");
      setQuote(null);
      await fetchBalances();

    } catch (error) {
      console.error("Swap failed:", error);
      setTransactionStatus(`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSwapping(false);
    }
  };

  const formatBalance = (balance: TokenBalance) => {
    return (Number(balance.amount) / Math.pow(10, balance.decimals)).toFixed(balance.decimals);
  };

  const getOutputAmount = () => {
    if (!quote) return "0";
    const outputDecimals = isSwappingAToB ? 6 : 9;
    return (Number(quote.quote.tokenEstOut) / Math.pow(10, outputDecimals)).toFixed(outputDecimals);
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#111827', margin: '0 0 8px 0' }}>SOL/USDC Swap</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>Trade on Orca's 0.16% fee tier pool</p>
      </div>

      {/* Balance Display */}
      {account && (
        <div style={{
          backgroundColor: '#f9fafb',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid #e5e7eb'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 16px 0' }}>Your Balances</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '16px',
              border: '1px solid #f3f4f6'
            }}>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>SOL</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>{formatBalance(solBalance)}</div>
            </div>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '16px',
              border: '1px solid #f3f4f6'
            }}>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>USDC</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827' }}>{formatBalance(usdcBalance)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Swap Interface */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
      }}>
        <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#111827', margin: '0 0 24px 0' }}>Swap Tokens</h3>

        {/* Swap Direction Toggle */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              checked={isSwappingAToB}
              onChange={() => setIsSwappingAToB(true)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ color: '#374151' }}>SOL → USDC</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              checked={!isSwappingAToB}
              onChange={() => setIsSwappingAToB(false)}
              style={{ marginRight: '8px' }}
            />
            <span style={{ color: '#374151' }}>USDC → SOL</span>
          </label>
        </div>

        {/* Input Amount */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '500',
            color: '#374151',
            marginBottom: '8px'
          }}>
            Amount ({isSwappingAToB ? 'SOL' : 'USDC'})
          </label>
          <input
            type="number"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            placeholder={`Enter ${isSwappingAToB ? 'SOL' : 'USDC'} amount`}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
            step="0.000001"
            min="0"
          />
        </div>

        {/* Quote Display */}
        {quote && (
          <div style={{
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '24px'
          }}>
            <div style={{ fontSize: '14px', fontWeight: '500', color: '#065f46', marginBottom: '8px' }}>Quote</div>
            <div style={{ color: '#047857' }}>
              You will receive approximately: <span style={{ fontWeight: '700' }}>{getOutputAmount()} {isSwappingAToB ? 'USDC' : 'SOL'}</span>
            </div>
            {poolInfo && (
              <div style={{ fontSize: '12px', color: '#059669', marginTop: '4px' }}>
                Pool: {poolInfo.address.slice(0, 8)}...{poolInfo.address.slice(-8)} (0.16% fee)
              </div>
            )}
          </div>
        )}

        {/* Swap Button */}
        <button
          onClick={handleSwap}
          disabled={!account || !quote || !inputAmount || isSwapping}
          className={cn(
            "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
            "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400",
            "h-11 rounded-md px-8 w-full"
          )}
        >
          {isSwapping ? "Swapping..." :
           !account ? "Connect Wallet" :
           !quote ? "Enter Amount" :
           `Swap ${inputAmount} ${isSwappingAToB ? 'SOL' : 'USDC'}`}
        </button>

        {/* Transaction Status */}
        {transactionStatus && (
          <div style={{
            marginTop: '16px',
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: transactionStatus.includes("failed") ? '#fef2f2' : '#eff6ff',
            border: transactionStatus.includes("failed") ? '1px solid #fca5a5' : '1px solid #93c5fd',
            color: transactionStatus.includes("failed") ? '#b91c1c' : '#1d4ed8'
          }}>
            {transactionStatus}
          </div>
        )}
      </div>
    </div>
  );
}

function PageContent() {
  const { account } = useWallet();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      padding: '32px 24px'
    }}>
      <div style={{
        maxWidth: '800px',
        margin: '0 auto'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: '32px'
        }}>
          <ConnectWalletButton />
        </div>
        {account ? (
          <SwapPage account={account} />
        ) : (
          <div style={{ textAlign: 'center', marginTop: '48px' }}>
            <p style={{ color: '#6b7280', fontSize: '18px' }}>Please connect your wallet to start trading</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <WalletProvider>
      <PageContent />
    </WalletProvider>
  );
}