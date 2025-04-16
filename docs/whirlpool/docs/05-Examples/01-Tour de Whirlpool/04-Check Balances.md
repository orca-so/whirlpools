# Check Balances

In this section let's set up the wallet to enable checking SOL and Token balances.

## Program Implementation
We can check the balances for SOL and tokens by opening Phantom.

Let's perform the same check using a program.

## Checking SOL Balance
Let's start with checking the SOL balance from a program.

### Code

Open your `tour_de_whirlpool` folder in Visual Studio Code, or your preferred development environment. Create a file called `011_get_sol_balance.ts` under the src folder with the following contents.

```tsx
import { Keypair, Connection } from "@solana/web3.js";
import secret from "../wallet.json";

const RPC_ENDPOINT_URL = "https://api.devnet.solana.com";
const COMMITMENT = 'confirmed';

async function main() {
  // Create a connection for sending RPC requests to Devnet
  const connection = new Connection(RPC_ENDPOINT_URL, COMMITMENT);

  // Read in the private key from wallet.json (The public and private key pair will be managed using the Keypair class)
  const keypair = Keypair.fromSecretKey(new Uint8Array(secret));

  // Display the RPC and the wallet's public key
  // When displaying the public key, use base58 encoding
  console.log("endpoint:", connection.rpcEndpoint);
  console.log("wallet pubkey:", keypair.publicKey.toBase58());

  // Obtain the SOL balance
  // Use the getBalance method from the Connection class
  // https://solana-labs.github.io/solana-web3.js/v1.x/classes/Connection.html#getBalance
  const sol_balance = await connection.getBalance(keypair.publicKey);

  // Display the SOL balance
  // Since SOL is internally managed as an integer value and denominated in lamports,
  // divide by 10^9 to obtain a value denominated in SOL.
  console.log("lamports:", sol_balance);
  console.log("SOL:", sol_balance / 10**9);
}

main();
```

### Execution Result
Run the code, and then verify that the public key and SOL balance match the Phantom UI.

```bash
$ ts-node src/011_get_sol_balance.ts
endpoint: https://api.devnet.solana.com
wallet pubkey: FptVFacYhPrwScJayvKXvwjGeZRbefnnEcgmSQkoRAXB
lamports: 2191782899
SOL: 2.191782899
```

![balance01](../../../static/img/04-Legacy%20SDK/05-Tour%20de%20Whirlpool/balance01.png)

### Key Points
- You can interact with Solana's Devnet using the RPC endpoint, "https://api.devnet.solana.com"
- Method for reading in a private key (read in wallet.json and create an instance of the Keypair class)
- Use the toBase58() method to display the public key in base58 encoding
- Use the Connection class's getBalance method to obtain the SOL balance
- SOL is denominated in lamports internally
- 1 SOL = 1,000,000,000 lamports

### API Used
- https://solana-labs.github.io/solana-web3.js/classes/Connection.html#getBalance

## Checking Token Balances
Next, let's check token balances from a program.

### Code
Create a file called `012_get_token_balance.ts` under the src folder with the following contents.

```tsx
import { Keypair, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DecimalUtil } from "@orca-so/common-sdk";
import { unpackAccount } from "@solana/spl-token";
import BN from "bn.js";
import secret from "../wallet.json";

const RPC_ENDPOINT_URL = "https://api.devnet.solana.com";
const COMMITMENT = 'confirmed';

async function main() {
  // Initialize a connection to the RPC and read in private key
  const connection = new Connection(RPC_ENDPOINT_URL, COMMITMENT);
  const keypair = Keypair.fromSecretKey(new Uint8Array(secret));
  console.log("endpoint:", connection.rpcEndpoint);
  console.log("wallet pubkey:", keypair.publicKey.toBase58());

  // https://everlastingsong.github.io/nebula/
  // devToken specification
  const token_defs = {
    "BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k": {name: "devUSDC", decimals: 6},
    "H8UekPGwePSmQ3ttuYGPU1szyFfjZR4N53rymSFwpLPm": {name: "devUSDT", decimals: 6},
    "Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa":  {name: "devSAMO", decimals: 9},
    "Afn8YB1p4NsoZeS5XJBZ18LTfEy5NFPwN46wapZcBQr6": {name: "devTMAC", decimals: 6},
  };

  // Obtain the token accounts from the wallet's public key
  //
  // {
  //   context: { apiVersion: '1.10.24', slot: 140791186 },
  //   value: [
  //     { account: [Object], pubkey: [PublicKey] },
  //     { account: [Object], pubkey: [PublicKey] },
  //     { account: [Object], pubkey: [PublicKey] },
  //     { account: [Object], pubkey: [PublicKey] }
  //   ]
  // }
  const accounts = await connection.getTokenAccountsByOwner(
    keypair.publicKey,
    { programId: TOKEN_PROGRAM_ID }
  );
  console.log("getTokenAccountsByOwner:", accounts);

  // Deserialize token account data
  for (let i=0; i<accounts.value.length; i++) {
    const value = accounts.value[i];

    // Deserialize
    const parsed_token_account = unpackAccount(value.pubkey, value.account);
    // Use the mint address to determine which token account is for which token
    const mint = parsed_token_account.mint;
    const token_def = token_defs[mint.toBase58()];
    // Ignore non-devToken accounts
    if ( token_def === undefined ) continue;

    // The balance is "amount"
    const amount = parsed_token_account.amount;
    // The balance is managed as an integer value, so it must be converted for UI display
    const ui_amount = DecimalUtil.fromBN(new BN(amount.toString()), token_def.decimals);

    console.log(
      "TokenAccount:", value.pubkey.toBase58(),
      "\n  mint:", mint.toBase58(),
      "\n  name:", token_def.name,
      "\n  amount:", amount.toString(),
      "\n  ui_amount:", ui_amount.toString()
    );
  }
}

main();
```

### Execution Result
Run the code, and then verify that the Phantom UI displays the same token balances.

The address displayed after "TokenAccount" will differ for different wallet addresses.

```bash
$ ts-node src/012_get_token_balance.ts
endpoint: https://api.devnet.solana.com
wallet pubkey: FptVFacYhPrwScJayvKXvwjGeZRbefnnEcgmSQkoRAXB getTokenAccountsByOwner: {
    context: { apiVersion: '1.10.29', slot: 151582140 },
    value: [ { account: [Object], pubkey: [PublicKey] },
        { account: [Object], pubkey: [PublicKey] },
        { account: [Object], pubkey: [PublicKey] },
        { account: [Object], pubkey: [PublicKey] }
    ] }
TokenAccount: B3PXuJ7FyXJ9wu97WZ2b3vt1tHoPQayaQbrTpPKRjUky
    mint: Afn8YB1p4NsoZeS5XJBZ18LTfEy5NFPwN46wapZcBQr6
    name: devTMAC
    amount: 151240169
    ui_amount: 151.240169
TokenAccount: FzAVSbhRDnncdqWLUzsxXpRM6wmB1h2Jb6obJZuRgpiw
    mint: BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k
    name: devUSDC
    amount: 15099547
    ui_amount: 15.099547
TokenAccount: 2uDMLemoyarwUCrnzzhJ4y5YFfeLpUYusgdDAZ4tv78w
    mint: H8UekPGwePSmQ3ttuYGPU1szyFfjZR4N53rymSFwpLPm
    name: devUSDT
    amount: 17102615
    ui_amount: 17.102615
TokenAccount: H5vU48wbEWtxsdqYZtcYLcAaEZ57jjcokoJKMct2LCAE
    mint: Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa
    name: devSAMO
    amount: 1322051824431
    ui_amount: 1322.051824431
```

![balance02](../../../static/img/04-Legacy%20SDK/05-Tour%20de%20Whirlpool/balance02.png)

### Key Points
- Use the getTokenAccountsByOwner() method of the Connection class to obtain token balances from a specified account.
- The data in the account you obtain is TokenAccount data and needs to be deserialized.
- You can deserialize the data using the deserializeTokenAccount method from TokenUtil.
- You can determine which TokenAccount is for which Token using the "mint" field.
- Just like SOL balances are denominated in lamports, token account balances are converted into integer values by moving the decimal point.
- The number of usable digits after the decimal point is defined for each token and can be referred to as "decimal" or "scale".
- Use the fromU64 method (convert from U64 format) in DecimalUtil for conversions that include moving the position of the decimal point, including lamports to SOL.

### getTokenAccountsByOwner in depth
In Solana, all information is handled by accounts. Programs manage what will be stored inside accounts. The TokenProgram, which manages tokens, defines two types of accounts for storing data, TokenAccount and Mint.

Because the token balance is stored in an account that holds TokenAccount information, getTokenAccountsByOwner will search for accounts that meet the criteria below.
- The account is owned by the TokenProgram.
- The data stored in the account is TokenAccount data.
- The token owner address, stored in the TokenAccount owner field, is the address of the specified wallet.

Since one TokenAccount can only store one token balance, the account structure looks like the following diagram.

![token-account-structure](../../../static/img/04-Legacy%20SDK/05-Tour%20de%20Whirlpool/token-account-structure.png)

### APIs Used
- https://solana-labs.github.io/solana-web3.js/classes/Connection.html#getTokenAccountsByOwner
- TokenUtil.deserializeTokenAccount
- DecimalUtil.fromU64

This completes the Basic Wallet Functionality (Checking Balances) section!
