import { interpret } from "xstate";
import {
    mintMachine,
    mintConfig,
    GatewaySession,
    GatewayMachineContext,
} from "../"; //"@renproject/rentx";
import RenJS from "@renproject/ren";
import { BinanceSmartChain, Ethereum } from "@renproject/chains-ethereum";
import { Bitcoin, BitcoinCash, Zcash } from "@renproject/chains-bitcoin";
import HDWalletProvider from "truffle-hdwallet-provider";
import Web3 from "web3";
import BigNumber from "bignumber.js";

const MNEMONIC = process.env.MNEMONIC;
const INFURA_URL = process.env.INFURA_URL;
const ethProvider = new HDWalletProvider(MNEMONIC, INFURA_URL, 0, 10);
const web3 = new Web3(ethProvider);
// Allow for an existing tx to be passed in via CLI
let parsedTx: GatewaySession;

if (process.argv[2]) {
    parsedTx = JSON.parse(process.argv[2]);
}

const mintTransaction: GatewaySession = parsedTx || {
    id: "a unique identifier",
    type: "mint",
    network: "testnet",
    sourceAsset: "btc",
    sourceChain: "bitcoin",
    destAddress: "ethereum address that will receive assets",
    destChain: "ethereum",
    targetAmount: 0.001,
    userAddress: "address that will sign the transaction",
    expiryTime: new Date().getTime() + 1000 * 60 * 60 * 24,
    transactions: {},
    customParams: {},
};

// A mapping of how to construct parameters for host chains,
// based on the destination network
export const toChainMap = {
    binanceSmartChain: (context: GatewayMachineContext) => {
        const { destAddress, destChain, network } = context.tx;
        const { providers } = context;
        return new BinanceSmartChain(providers[destChain], network).Account({
            address: destAddress,
        });
    },
    ethereum: (context: GatewayMachineContext) => {
        const { destAddress, destChain, network } = context.tx;
        const { providers } = context;

        return Ethereum(providers[destChain], network).Account({
            address: destAddress,
        });
    },
} as any;

// A mapping of how to construct parameters for source chains,
// based on the source network
export const fromChainMap = {
    bitcoin: () => Bitcoin(),
    zcash: () => Zcash(),
    bitcoinCash: () => BitcoinCash(),
} as any;

const blockchainProviders = {
    ethereum: ethProvider,
};

web3.eth
    .getAccounts()
    .then((accounts) => {
        mintTransaction.destAddress = accounts[0];
        mintTransaction.userAddress = accounts[0];
        const machine = mintMachine.withConfig(mintConfig).withContext({
            tx: mintTransaction,
            sdk: new RenJS("testnet"),
            providers: blockchainProviders,
            fromChainMap,
            toChainMap,
        });

        // Interpret the machine, and add a listener for whenever a transition occurs.
        // The machine will detect which state the transaction should be in,
        // and perform the neccessary next actions
        let promptedGatewayAddress = false;
        let detectedDeposit = false;
        let claimed = false;
        const service = interpret(machine).onTransition((state) => {
            if (!promptedGatewayAddress && state.context.tx.gatewayAddress) {
                console.log(
                    "Please deposit",
                    new BigNumber(state.context.tx.suggestedAmount)
                        .div(1e8)
                        .toFixed(),
                    "BTC to",
                    state.context.tx.gatewayAddress,
                );

                console.log(
                    "Restore with this object",
                    JSON.stringify(state.context.tx),
                );

                promptedGatewayAddress = true;
            }

            const deposit = Object.values(
                state.context.tx.transactions || {},
            )[0];

            if (!detectedDeposit && deposit) {
                console.log("Detected deposit");
                console.log(
                    "Restore with this object",
                    JSON.stringify(state.context.tx),
                );
                detectedDeposit = true;
            }

            if (
                state.context.mintRequests.includes(deposit?.sourceTxHash) &&
                !claimed
            ) {
                // implement logic to determine whether deposit is valid
                // In our case we take the first deposit to be the correct one
                // and immediately sign
                console.log("Signing transaction");
                claimed = true;
                service.send({
                    type: "CLAIM",
                    data: deposit,
                    hash: deposit.sourceTxHash,
                });
            }

            if (deposit?.destTxHash) {
                // If we have a destination txHash, we have successfully minted BTC
                console.log(
                    "Your BTC has been minted! TxHash",
                    deposit.destTxHash,
                );
                service.stop();
            }
        });

        // Start the service
        service.start();
    })
    .catch(console.error);
