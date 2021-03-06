/* eslint-disable no-console */

import * as Chains from "@renproject/chains";

import {
    LockAndMintParams,
    LogLevel,
    RenNetwork,
    SimpleLogger,
} from "@renproject/interfaces";
import RenJS from "@renproject/ren";
import { extractError, SECONDS, sleep } from "@renproject/utils";
import chai from "chai";
import { blue, cyan, green, magenta, red, yellow } from "chalk";
import CryptoAccount from "send-crypto";
import HDWalletProvider from "truffle-hdwallet-provider";
import { config as loadDotEnv } from "dotenv";
import BigNumber from "bignumber.js";
import { TerraAddress } from "@renproject/chains-terra/build/main/api/deposit";
import { BscConfigMap, EthereumConfigMap } from "@renproject/chains";
import Web3 from "web3";

chai.should();

loadDotEnv();

const colors = [green, magenta, yellow, cyan, blue, red];

const MNEMONIC = process.env.MNEMONIC;
const PRIVATE_KEY = process.env.TESTNET_PRIVATE_KEY;

const FAUCET_ASSETS = ["BTC", "ZEC", "BCH", "ETH", "FIL", "LUNA"];

describe("Refactor: mint", () => {
    const longIt = process.env.ALL_TESTS ? it : it.skip;
    longIt("mint to contract", async function () {
        this.timeout(100000000000);

        const network = RenNetwork.MainnetVDot3;
        const asset = "FIL" as string;
        const from = Chains.Filecoin();

        const ethNetwork = EthereumConfigMap[network];

        const account = new CryptoAccount(PRIVATE_KEY, {
            network: "testnet",
            apiAddress: "https://lotus-cors-proxy.herokuapp.com/",
            terra: {
                URL: "https://tequila-lcd.terra.dev",
            },
        });

        const logLevel: LogLevel = LogLevel.Log;
        const renJS = new RenJS(network, { logLevel });

        const infuraURL = `${ethNetwork.infura}/v3/${process.env.INFURA_KEY}`; // renBscDevnet.infura
        // const infuraURL = ethNetwork.infura; // renBscDevnet.infura
        const provider = new HDWalletProvider(MNEMONIC, infuraURL, 0, 10);
        const ethAddress = (await new Web3(provider).eth.getAccounts())[0];

        const params: LockAndMintParams = {
            asset,
            from,
            to: Chains.Ethereum(provider, ethNetwork).Account({
                address: ethAddress,
            }),
        };

        const assetDecimals = await params.from.assetDecimals(asset);

        // Use 0.0001 more than fee.
        let suggestedAmount: BigNumber;
        try {
            const fees = await renJS.getFees(params);
            suggestedAmount = fees.lock.div(
                new BigNumber(10).exponentiatedBy(assetDecimals),
            );
        } catch (error) {
            console.error("Error fetching fees:", red(extractError(error)));
            if (asset === "FIL") {
                suggestedAmount = new BigNumber(0.2);
            } else {
                suggestedAmount = new BigNumber(0.0015);
            }
        }

        const lockAndMint = await renJS.lockAndMint(params);

        console.info(
            `Send at least ${suggestedAmount.toFixed()} ${asset} to`,
            lockAndMint.gatewayAddress,
        );

        const faucetSupported =
            ethNetwork.isTestnet && FAUCET_ASSETS.indexOf(asset) >= 0;

        if (faucetSupported) {
            console.info(
                `${asset} balance: ${await account.balanceOf(
                    asset,
                )} ${asset} (${await account.address(asset)})`,
            );
        }

        await new Promise((resolve, reject) => {
            let i = 0;

            lockAndMint.on("deposit", (deposit) => {
                const hash = deposit.txHash();

                const color = colors[i % colors.length];
                i += 1;

                deposit._state.logger = new SimpleLogger(
                    logLevel,
                    color(`[${hash.slice(0, 6)}]`),
                );

                deposit._state.logger.log(
                    `Received ${
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        new BigNumber((deposit.depositDetails as any).amount)
                            .div(
                                new BigNumber(10).exponentiatedBy(
                                    assetDecimals,
                                ),
                            )
                            .toFixed()
                    } ${asset}`,
                    deposit.depositDetails,
                    deposit.params.from.utils.transactionExplorerLink
                        ? deposit.params.from.utils.transactionExplorerLink(
                              deposit.depositDetails.transaction,
                          )
                        : "",
                );

                RenJS.defaultDepositHandler(deposit)
                    .then(resolve)
                    .catch((error) =>
                        deposit._state.logger.error(red("error:"), error),
                    );
            });

            sleep(30 * SECONDS)
                .then(() => {
                    // If there's been no deposits, send one.
                    if (faucetSupported && i === 0) {
                        const sendAmount = suggestedAmount.times(5);
                        console.log(
                            `${blue("[faucet]")} Sending ${blue(
                                sendAmount.toFixed(),
                            )} ${blue(asset)} to ${blue(
                                typeof lockAndMint.gatewayAddress === "string"
                                    ? lockAndMint.gatewayAddress
                                    : JSON.stringify(
                                          lockAndMint.gatewayAddress,
                                      ),
                            )}`,
                        );

                        const options = { params: undefined, memo: undefined };
                        let address = "";
                        if (typeof lockAndMint.gatewayAddress === "string") {
                            address = lockAndMint.gatewayAddress;
                        } else if (asset === "FIL" || asset === "LUNA") {
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                            address = (lockAndMint.gatewayAddress as Chains.FilAddress)
                                .address;
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                            options.params = (lockAndMint.gatewayAddress as Chains.FilAddress).params;
                            options.memo = (lockAndMint.gatewayAddress as TerraAddress).memo;
                        } else {
                            console.error(`Unknown address format.`);
                            return;
                        }
                        account
                            .send(address, sendAmount, asset, options)
                            .catch(reject);
                    }
                })
                .catch(console.error);
        });
    });
});
