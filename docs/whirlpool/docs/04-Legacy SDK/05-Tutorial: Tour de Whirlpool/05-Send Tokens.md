# Send Tokens
In this section let's set up the wallet to enable sending SOL and tokens.

## Program Implementation
If you click on SOL or a token, you have the option to send to another wallet. Let's enable this functionality through a program as well.

![send-tokens](../../../static/img/04-Legacy%20SDK/05-Tour%20de%20Whirlpool/send-tokens.png)

## Sending SOL

Let's try sending SOL from a program.

### Code
Create a file called `013_transfer_sol.ts` under the src directory containing the following contents. The destination is defined as `dest_pubkey`, but feel free to change it or leave it the same as desired.

```tsx
import { Keypair, Connection, SystemProgram, PublicKey, Transaction } from "@solana/web3.js";
import secret from "../wallet.json";

const RPC_ENDPOINT_URL = "https://api.devnet.solana.com";
const COMMITMENT = 'confirmed';

async function main() {
  // Initialize a connection to the RPC and read in private key
  const connection = new Connection(RPC_ENDPOINT_URL, COMMITMENT);
  const keypair = Keypair.fromSecretKey(new Uint8Array(secret));
  console.log("endpoint:", connection.rpcEndpoint);
  console.log("wallet pubkey:", keypair.publicKey.toBase58());

  // SOL destination
  const dest_pubkey = new PublicKey("vQW71yo6X1FjTwt9gaWtHYeoGMu7W9ehSmNiib7oW5G");

  // Amount to send
  const amount = 10_000_000; // lamports = 0.01 SOL

  // Build the instruction to send SOL
  const transfer_ix = SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: dest_pubkey,
    lamports: amount,
  });

  // Create a transaction and add the instruction
  const tx = new Transaction();
  tx.add(transfer_ix);

  // Send the transaction
  const signers = [keypair];
  const signature = await connection.sendTransaction(tx, signers);
  console.log("signature:", signature);

  // Wait for the transaction to complete
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    signature
  });
}

main();
```

### Execution Result
Execute the script and verify that the transaction was successful.

```bash
$ ts-node ./src/013_transfer_sol.ts 
endpoint: https://api.devnet.solana.com 
wallet pubkey: FptVFacYhPrwScJayvKXvwjGeZRbefnnEcgmSQkoRAXB 
signature: 2EiiHe5JqpbJTUChaeZwUiAEtRtvD9BwWHqX5pKaHhMA5hPEyCuQwEDLjtjHZY6QnHybLdfTS9Rv6k75tLisnf8N
```

Open up the [Devnet version of Solscan](https://solscan.io/?cluster=devnet) and enter the transaction Id labeled "signature". Verify that 0.01 was sent.

Since the transaction only contains one instruction, #1 is the SOL transfer.

If you are unable to find the transaction, make sure that you have the network dropdown in the upper right set to "DEVNET".

![solscan-tx-01](../../../static/img/04-Legacy%20SDK/05-Tour%20de%20Whirlpool/solscan-tx01.avif)

### Key Points
- The basic flow is to add an instruction to a transaction, then execute the transaction.
- You can use the `transfer()` method from `SystemProgram` to create an instruction to send SOL.
- The sender must sign the transaction for sending SOL.
- You can also verify transaction transactions executed on Devnet using SolScan.

### APIs Used
https://solana-labs.github.io/solana-web3.js/classes/SystemProgram.html#transfer

## Sending Tokens
Next, let's try sending Tokens from a program.

### Code
Create a file named `014_transfer_token.ts` under the src directory with the following contents. The destination is defined as `dest_pubkey`, but feel free to change it or leave it the same as desired.

```tsx
import { Keypair, Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, AccountLayout, getAssociatedTokenAddressSync, createTransferCheckedInstruction } from "@solana/spl-token";
import { resolveOrCreateATA, ZERO } from "@orca-so/common-sdk";
import secret from "../wallet.json";

const RPC_ENDPOINT_URL = "https://api.devnet.solana.com";
const COMMITMENT = 'confirmed';

async function main() {
  // Initialize a connection to the RPC and read in private key
  const connection = new Connection(RPC_ENDPOINT_URL, COMMITMENT);
  const keypair = Keypair.fromSecretKey(new Uint8Array(secret));
  console.log("endpoint:", connection.rpcEndpoint);
  console.log("wallet pubkey:", keypair.publicKey.toBase58());

  // devSAMO
  // https://everlastingsong.github.io/nebula/
  const DEV_SAMO_MINT = new PublicKey("Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa");
  const DEV_SAMO_DECIMALS = 9;

  // Destination wallet for the devSAMO
  const dest_pubkey = new PublicKey("vQW71yo6X1FjTwt9gaWtHYeoGMu7W9ehSmNiib7oW5G");

  // Amount to send
  const amount = 1_000_000_000; // 1 devSAMO

  // Obtain the associated token account from the source wallet
  const src_token_account = getAssociatedTokenAddressSync(DEV_SAMO_MINT, keypair.publicKey);

  // Obtain the associated token account for the destination wallet.
  const {address: dest_token_account, ...create_ata_ix} = await resolveOrCreateATA(
    connection,
    dest_pubkey,
    DEV_SAMO_MINT,
    ()=>connection.getMinimumBalanceForRentExemption(AccountLayout.span),
    ZERO,
    keypair.publicKey
  );

  // Create the instruction to send devSAMO
  const transfer_ix = createTransferCheckedInstruction(
    src_token_account,
    DEV_SAMO_MINT,
    dest_token_account,
    keypair.publicKey,
    amount,
    DEV_SAMO_DECIMALS,
    [],
    TOKEN_PROGRAM_ID
  );

  // Create the transaction and add the instruction
  const tx = new Transaction();
  // Create the destination associated token account (if needed)
  create_ata_ix.instructions.map((ix) => tx.add(ix));
  // Send devSAMO
  tx.add(transfer_ix);

  // Send the transaction
  const signers = [keypair];
  const signature = await connection.sendTransaction(tx, signers);
  console.log("signature:", signature);

  // Wait for the transaction to be confirmed
  const latest_blockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({signature, ...latest_blockhash});
}

main();
```

### Execution Result
Run the code, and then verify that the devSAMO token has been sent.

```bash
$ ts-node ./src/014_transfer_token.ts
endpoint: https://api.devnet.solana.com
wallet pubkey: FptVFacYhPrwScJayvKXvwjGeZRbefnnEcgmSQkoRAXB 
signature: 4NXrCbHJHBqgV4oDnWHCPFe7emiVf9SmRjqGxEgKFRAu2Wc8LrmWScygUfdfzZjCifjj4xsmnVke9EVxixceCXjk
```

![solscan-tx-02](../../../static/img/04-Legacy%20SDK/05-Tour%20de%20Whirlpool/solscan-tx02.png)

### Key Points
- You can create an instruction to send a token using the `createTransferCheckedInstruction()` method from the Token class.
- The destination address in the `createTransferCheckedInstruction()` method is the associated token account, not the destination wallet.
- If a destination associated token account does not exist yet, it needs to be created. (Since SOL is needed to create the account, choosing not to create a new account is also an option)
- You can obtain the source associated token account address using the `deriveATA()` function.
- You can obtain the destination associated token address and the instructions to create it if needed using the `resolveOrCreateATA()` function.

### Additional Info About Associated Token Accounts
When sending SOL, the public key of the destination wallet is specified as the destination, and the account associated with this public key is the one that is updated.

On the other hand, when sending tokens, the transfer occurs between associated token accounts (ATA). Normally, the user will not notice this is happening behind the scenes, since wallets, such as Phantom, can handle sending tokens using the public key of the destination wallet. However, when sending tokens from a program, you do need to be concerned with sending tokens from one ATA to another ATA.

In addition, if the destination wallet has not previously interacted with the token being sent, it is possible that an ATA has not yet been created. In that case, the source needs to create the account on behalf of the destination, or the destination needs to create the account in advance.

![ata-account-structure](../../../static/img/04-Legacy%20SDK/05-Tour%20de%20Whirlpool/ata-account-structure.png)
### Additional Info About resolveOrCreateATA
`resolveOrCreateATA` derives an ATA (use deriveATA if this is all that is needed) in addition to building the instructions required to create an associated token account.

One convenient aspect of this function is that it will verify if the ATA already exists, and only build the instructions if they are needed. Because of this, the client can write code to handle this situation without the need for branching.

You can handle sending tokens in a similar fashion without using `resolveOrCreateATA`, but because of the convenience they provide alongside the Whirlpools SDK, we highlighted and used the `deriveATA` and `resolveOrCreateATA` functions in this section.

### APIs Used
- Token.createTransferCheckedInstruction
- deriveATA
- resolveOrCreateATA

This completes the Basic Wallet Functionality (Sending) section!