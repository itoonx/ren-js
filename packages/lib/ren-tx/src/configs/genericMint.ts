/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
// TODO: Improve typings.

import { DepositCommon } from "@renproject/interfaces";
import RenJS from "@renproject/ren";
import {
    LockAndMint,
    LockAndMintDeposit,
} from "@renproject/ren/build/main/lockAndMint";
import BigNumber from "bignumber.js";
import {
    Actor,
    assign,
    MachineOptions,
    Receiver,
    Sender,
    spawn,
    send,
    actions,
} from "xstate";

import { depositMachine, DepositMachineContext } from "../machines/deposit";
import { GatewayMachineContext, GatewayMachineEvent } from "../machines/mint";
import { GatewaySession, GatewayTransaction } from "../types/transaction";

/*
  Sample mintChainMap / lockChainMap implementations
  We don't implement these to prevent mandating specific chains

const mintChainMap: {
    [key in string]: (c: GatewayMachineContext) => MintChain<any>;
} = {
    binanceSmartChain: (context: GatewayMachineContext) => {
        const { destAddress, destNetwork } = context.tx;
        const { providers } = context;
        return new BinanceSmartChain(providers[destNetwork]).Account({
            address: destAddress,
        }) as MintChain<any>;
    },
    ethereum: (context: GatewayMachineContext): MintChain => {
        const { destAddress, destNetwork } = context.tx;
        const { providers } = context;

        return Ethereum(providers[destNetwork]).Account({
            address: destAddress,
        }) as MintChain<any>;
    },
};

const lockChainMap = {
    bitcoin: () => Bitcoin(),
    zcash: () => Zcash(),
    bitcoinCash: () => BitcoinCash(),
};
*/

const hexify = (obj: { [key: string]: any }) => {
    if (!obj) return;
    const entries = Object.entries(obj);
    for (let [k, v] of entries) {
        if (Buffer.isBuffer(v)) {
            obj[k] = v.toString("hex");
        }
    }
    return obj;
};

export const renLockAndMint = async (context: GatewayMachineContext) => {
    const { nonce, destChain, sourceChain, sourceAsset } = context.tx;
    const { sdk, fromChainMap, toChainMap } = context;

    const mint = await sdk.lockAndMint({
        asset: sourceAsset.toUpperCase(),
        from: fromChainMap[sourceChain](context),
        to: toChainMap[destChain](context),
        nonce,
    });

    return mint;
};

// Format a transaction and get the gateway address
const txCreator = async (context: GatewayMachineContext) => {
    // TX may be in a state where the gateway address was provided,
    // but no deposit was picked up
    if (!context.tx.nonce) {
        context.tx.nonce = RenJS.utils.randomNonce().toString("hex");
    }

    const { targetAmount, sourceAsset, sourceChain, destChain } = context.tx;

    const to = context.toChainMap[destChain](context);
    const from = context.fromChainMap[sourceChain](context);

    const decimals = await from.assetDecimals(sourceAsset.toUpperCase());

    let suggestedAmount = new BigNumber(targetAmount).times(
        new BigNumber(10).exponentiatedBy(decimals),
    );

    if (context.autoFees) {
        // This will throw and be caught by the machine if we fail to get fees
        // If the user specifies that they want to have fees added,
        // we should not silently fail, as they will be prompted to deposit
        // an incorrect amount

        const fees = await context.sdk.getFees({
            asset: sourceAsset.toUpperCase(),
            from,
            to,
        });

        suggestedAmount = suggestedAmount
            .plus(fees.lock || 0)
            .plus(suggestedAmount.multipliedBy(fees.mint * 0.001));
    }

    const minter = await renLockAndMint(context);
    const gatewayAddress = minter?.gatewayAddress;
    const newTx: GatewaySession = {
        ...context.tx,
        suggestedAmount: suggestedAmount.decimalPlaces(0).toFixed(),
        gatewayAddress,
    };
    return newTx;
};

const initMinter = async (
    context: GatewayMachineContext,
    callback: Sender<GatewayMachineEvent>,
) => {
    const minter = await renLockAndMint(context);

    if (minter.gatewayAddress != context.tx.gatewayAddress) {
        callback({
            type: "ERROR_LISTENING",
            data: new Error(
                `Incorrect gateway address ${minter.gatewayAddress} != ${context.tx.gatewayAddress}`,
            ),
        });
    }
    return minter;
};

const handleSettle = async (
    sourceTxHash: string,
    deposit: LockAndMintDeposit,
    callback: Sender<any>,
) => {
    try {
        await deposit
            .confirmed()
            .on("target", (confs, targetConfs) => {
                const confirmedTx = {
                    sourceTxHash,
                    sourceTxConfs: confs,
                    sourceTxConfTarget: targetConfs,
                };
                callback({
                    type: "CONFIRMATION",
                    data: confirmedTx,
                });
            })
            .on("confirmation", (confs, targetConfs) => {
                const confirmedTx = {
                    sourceTxHash,
                    sourceTxConfs: confs,
                    sourceTxConfTarget: targetConfs,
                };
                callback({
                    type: "CONFIRMATION",
                    data: confirmedTx,
                });
            });
        callback({
            type: "CONFIRMED",
            data: {
                sourceTxHash,
            },
        });
    } catch (e) {
        callback({
            type: "ERROR",
            data: {
                sourceTxHash,
            },
            error: e,
        });
        console.error(e);
    }
};

const handleSign = async (
    sourceTxHash: string,
    deposit: LockAndMintDeposit,
    callback: Sender<any>,
) => {
    try {
        const v = await deposit
            .signed()
            .on("status", (state) => console.log(state));

        if (!v._state.queryTxResult || !v._state.queryTxResult.out) {
            console.error("missing response data", v._state.queryTxResult);
            callback({
                type: "SIGN_ERROR",
                data: {
                    sourceTxHash,
                },
                error: new Error("No signature!").toString(),
            });
            return;
        }
        if (
            v._state.queryTxResult.out &&
            v._state.queryTxResult.out.revert !== undefined
        ) {
            callback({
                type: "SIGN_ERROR",
                data: {
                    sourceTxHash,
                },
                error: v._state.queryTxResult.out.revert.toString(),
            });
            return;
        } else {
            callback({
                type: "SIGNED",
                data: {
                    sourceTxHash,
                    renResponse: hexify(v._state.queryTxResult.out),
                    signature: v._state.queryTxResult.out.signature?.toString(
                        "hex",
                    ),
                },
            });
        }
    } catch (e) {
        console.error("Sign error!", e);
        // If a tx has already been minted, we will get an error at this step
        // We can assume that a "utxo spent" error implies that the asset has been minted
        callback({
            type: "SIGN_ERROR",
            data: {
                sourceTxHash,
            },
            error: e,
        });
    }
};

const handleMint = async (
    sourceTxHash: string,
    deposit: LockAndMintDeposit,
    callback: Sender<any>,
) => {
    await deposit
        .mint()
        .on("transactionHash", (transactionHash) => {
            const submittedTx = {
                sourceTxHash,
                destTxHash: transactionHash,
            };
            callback({
                type: "SUBMITTED",
                data: submittedTx,
            });
        })
        .catch((e) => {
            callback({
                type: "SUBMIT_ERROR",
                data: { sourceTxHash },
                error: e,
            });
            console.error("Submit error!", e);
        });
};

const mintFlow = async (
    context: GatewayMachineContext,
    callback: Sender<GatewayMachineEvent>,
    receive: Receiver<any>,
    minter: LockAndMint<any, DepositCommon<any>, any, any, any>,
) => {
    const deposits = new Map<string, LockAndMintDeposit>();

    const depositHandler = (deposit: LockAndMintDeposit) => {
        const txHash = deposit.params.from.transactionID(
            deposit.depositDetails.transaction,
        );

        //        const trackedDeposit = deposits.get(txHash);

        deposits.set(txHash, deposit);

        const persistedTx = context.tx.transactions[txHash];

        const rawSourceTx = deposit.depositDetails;
        const depositState: GatewayTransaction = persistedTx || {
            sourceTxHash: txHash,
            renVMHash: deposit.txHash(),
            sourceTxAmount: parseInt(rawSourceTx.amount),
            sourceTxConfs: 0,
            rawSourceTx,
        };

        if (!persistedTx) {
            callback({
                type: "DEPOSIT",
                data: { ...depositState },
            });
        }
        callback({ type: "RESTORED", data: depositState });
    };

    minter.on("deposit", depositHandler);

    receive((event) => {
        const deposit = deposits.get(event.hash);
        if (!deposit) {
            // Theoretically this should never happen
            throw new Error("missing deposit!: " + event.hash);
        }

        switch (event.type) {
            case "SETTLE":
                handleSettle(event.hash, deposit, callback);
                break;
            case "SIGN":
                handleSign(event.hash, deposit, callback);
                break;
            case "MINT":
                handleMint(event.hash, deposit, callback);
                break;
        }
    });

    receive((event) => {
        switch (event.type) {
            case "RESTORE":
                minter
                    .processDeposit(event.data.rawSourceTx)
                    .then((r) => {
                        // Previously the on('deposit') event would have fired when restoring
                        // Now, we use the promise result to set up the handler as well in
                        // case the `deposit` event does not fire
                        depositHandler(r);
                    })
                    .catch((e) => {
                        callback({
                            type: "ERROR",
                            data: event.data,
                            error: e,
                        });
                        console.error(e);
                    });
                break;
        }
    });
};

// Listen for confirmations on the source chain
const depositListener = (context: GatewayMachineContext) => (
    callback: Sender<any>,
    receive: Receiver<any>,
) => {
    let cleanup = () => {};

    initMinter(context, callback)
        .then((minter) => {
            cleanup = () => minter.removeAllListeners();
            mintFlow(context, callback, receive, minter);
        })
        .catch((e) => {
            callback({ type: "ERROR", error: e });
            console.error(e);
        });

    return () => {
        cleanup();
    };
};

// Spawn an actor that will listen for either all deposits to a gatewayAddress,
// or to a single deposit if present in the context
const listenerAction = assign<GatewayMachineContext>({
    depositListenerRef: (c: GatewayMachineContext, _e: any) => {
        let actorName = `${c.tx.id}SessionListener`;
        if (c.depositListenerRef) {
            console.warn("listener already exists");
            return c.depositListenerRef;
        }
        const cb = depositListener(c);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        return spawn(cb, actorName) as Actor<any>;
    },
});

const spawnDepositMachine = (
    machineContext: DepositMachineContext,
    name: string,
) =>
    spawn(
        depositMachine.withContext(machineContext).withConfig({
            actions: {
                listenerAction: listenerAction as any,
            },
        }),
        {
            sync: true,
            name,
        },
    ) as Actor<any>;

export const mintConfig: Partial<MachineOptions<GatewayMachineContext, any>> = {
    services: {
        txCreator,
        depositListener,
    },
    actions: {
        broadcast: actions.pure((ctx, event) => {
            return Object.values(ctx.depositMachines || {}).map((m) =>
                send(event, { to: m.id }),
            );
        }),

        forwardEvent: send(
            (_, b) => {
                return b;
            },
            {
                to: (_ctx: GatewayMachineContext) => "depositListener",
            },
        ),

        routeEvent: send(
            (_, b) => {
                return b;
            },
            {
                to: (
                    ctx: GatewayMachineContext,
                    evt: { type: string; data: { sourceTxHash: string } },
                ) => {
                    const machines = ctx.depositMachines || {};
                    return machines[evt.data.sourceTxHash]?.id || "missing";
                },
            },
        ),

        spawnDepositMachine: assign({
            depositMachines: (context, evt) => {
                const machines = context.depositMachines || {};
                if (machines[evt.data?.sourceTxHash] || !evt.data) {
                    return machines;
                }
                const machineContext = {
                    ...context,
                    deposit: evt.data,
                };

                // We don't want child machines to have references to siblings
                delete (machineContext as any).depositMachines;
                machines[evt.data.sourceTxHash] = spawnDepositMachine(
                    machineContext,
                    `${String(evt.data.sourceTxHash)}`,
                );
                return machines;
            },
        }),

        depositMachineSpawner: assign({
            depositMachines: (context, _) => {
                const machines = context.depositMachines || {};
                for (const tx of Object.entries(
                    context.tx.transactions || {},
                )) {
                    const machineContext = {
                        ...context,
                        deposit: tx[1],
                    };

                    // We don't want child machines to have references to siblings
                    delete (machineContext as any).depositMachines;
                    machines[tx[0]] = spawnDepositMachine(
                        machineContext,
                        `${machineContext.deposit.sourceTxHash}`,
                    );
                }
                return machines;
            },
        }),
        listenerAction: listenerAction as any,
    },

    guards: {
        isRequestCompleted: ({ mintRequests }, evt) =>
            (mintRequests || []).includes(evt.data?.sourceTxHash) &&
            evt.data.destTxHash,
        isCompleted: ({ tx }, evt) =>
            evt.data?.sourceTxAmount >= tx.targetAmount,
        isExpired: ({ tx }) => tx.expiryTime < new Date().getTime(),
        isCreated: ({ tx }) => (tx.gatewayAddress ? true : false),
    },
};
