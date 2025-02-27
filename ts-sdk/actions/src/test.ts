import { setRpc } from "@orca-so/tx-sender";
import { setPayerFromBytes } from "./config";
import { harvestAllPositionFees } from ".";

const rpcUrl =
  "https://mainnet.helius-rpc.com/?api-key=74cee39a-f02b-46c0-a4a8-2398b8ff10e8";

const main = async () => {
  await setRpc(rpcUrl);

  const txs = await harvestAllPositionFees();
  console.log(txs);
};

main();
