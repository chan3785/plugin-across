import { elizaLogger } from "@elizaos/core";
import {
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
    ModelClass,
    type Action,
} from "@elizaos/core";
import { composeContext } from "@elizaos/core";
import { generateObjectDeprecated } from "@elizaos/core";
import { createUserWalletClient } from "../viem";
import { createAcrossClient } from "@across-protocol/app-sdk";
import { Address, parseUnits } from "viem";
import {
    adjustInputAmountForOuput,
    createTransactionUrl,
} from "src/environments";
import { supportedChains } from "src/constants";

export interface DepositContent extends Content {
    recipient: string;
    amount: string | bigint;
    srcChainName: string;
    destChainName: string;
    token: string;
}

function isDepositContent(content: any): content is DepositContent {
    console.log("Content for Bridge", content);
    return (
        typeof content.recipient === "string" &&
        (typeof content.amount === "string" ||
            typeof content.amount === "bigint") &&
        typeof content.srcChainName === "string" &&
        typeof content.destChainName === "string" &&
        typeof content.token === "string"
    );
}

const depositTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "recipient": "0x2badda48c062e861ef17a96a806c451fd296a49f45b272dee17f85b0e32663fd",
    "amount": "1000",
    "sourceChain": "arbitrum"
    "destinationChain": "base"
    "tokenName": "USDC"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested token transfer:
- Recipient wallet address
- Amount to transfer
- source chain id
- destination chain id
- token name or token address

Respond with a JSON markdown block containing only the extracted values.`;

export default {
    name: "BRIDGE_DEPOSIT",
    similes: ["DEPOSIT", "BRIDGE_TOKEN", "SEND", "bridge", "Bridge", "BRIDGE"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating bridging from user:", message.userId)
            
        return true;
    },
    description: "Transfer tokens from the agent's wallet to another address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting BRIDGE_DEPOSIT handler...");
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
        }

        // Compose transfer context
        const depositContext = composeContext({
            state,
            template: depositTemplate,
        });

        // Generate transfer content
        const content = await generateObjectDeprecated({
            runtime,
            context: depositContext,
            modelClass: ModelClass.SMALL,
        });

        // Validate transfer content
        if (!isDepositContent(content)) {
            console.error("Invalid content for BRIDGE_DEPOSIT action.");
            if (callback) {
                callback({
                    text: "Unable to process bridge request. Invalid content provided.",
                    content: { error: "Invalid transfer content" },
                });
            }
            return false;
        }

        try {
            const sourceChainName = content.srcChainName;
            const destinationChainName = content.destChainName;
            const USDC_DECIMALS = 6;
            const inputAmount = parseUnits(
                content.amount.toString(),
                USDC_DECIMALS
            );

            const privateKey = runtime.getSetting("ACROSS_PRIVATE_KEY");
            const sourceChainConfig = supportedChains.find(
                (chain) => chain.chainName === sourceChainName
            );
            const destinationChainConfig = supportedChains.find(
                (chain) => chain.chainName === destinationChainName
            );
            const wallet = createUserWalletClient(
                privateKey,
                sourceChainConfig.viemChain
            );
            const acrossClient = createAcrossClient({
                integratorId: "0xdead",
                chains: [
                    sourceChainConfig.viemChain,
                    destinationChainConfig.viemChain,
                ],
            });

            const route = {
                originChainId: sourceChainConfig.chainId,
                destinationChainId: destinationChainConfig.chainId,
                inputToken: sourceChainConfig.tokenAddress.usdc as Address,
                outputToken: destinationChainConfig.tokenAddress
                    .usdc as Address,
            };

            console.log("Route", route);
            const quote = await acrossClient.getQuote({
                route,
                inputAmount: inputAmount,
            });

            const adjustedInputAmount = adjustInputAmountForOuput(
                inputAmount,
                quote.fees.totalRelayFee.pct
            );
            const depositParams = {
                ...quote.deposit,
                inputAmount: adjustedInputAmount,
                outputAmount: inputAmount,
            };
            await acrossClient.executeQuote({
                walletClient: wallet,
                deposit: depositParams, // returned by `getQuote`
                onProgress: (progress) => {
                    if (
                        progress.step === "approve" &&
                        progress.status === "txSuccess"
                    ) {
                        // if approving an ERC20, you have access to the approval receipt
                        const { txReceipt } = progress;
                        console.log(
                            `Approved ${sourceChainConfig.tokenAddress.usdc} on ${sourceChainConfig.viemChain.name}`
                        );
                        console.log(
                            createTransactionUrl(
                                sourceChainConfig.viemChain,
                                txReceipt.transactionHash
                            )
                        );
                    }
                    if (
                        progress.step === "deposit" &&
                        progress.status === "txSuccess"
                    ) {
                        // once deposit is successful you have access to depositId and the receipt
                        const { depositId, txReceipt } = progress;
                        console.log(
                            `Deposited ${sourceChainConfig.tokenAddress.usdc} on ${sourceChainConfig.viemChain.name}`
                        );
                        console.log(
                            createTransactionUrl(
                                sourceChainConfig.viemChain,
                                txReceipt.transactionHash
                            )
                        );
                    }
                    if (
                        progress.step === "fill" &&
                        progress.status === "txSuccess"
                    ) {
                        // if the fill is successful, you have access the following data
                        const { txReceipt, actionSuccess } = progress;
                        // actionSuccess is a boolean flag, telling us if your cross chain messages were successful
                        console.log(
                            `Approved ${destinationChainConfig.tokenAddress.usdc} on ${destinationChainConfig.viemChain.name}`
                        );
                        console.log(
                            createTransactionUrl(
                                destinationChainConfig.viemChain,
                                txReceipt.transactionHash
                            )
                        );

                        if (actionSuccess) {
                            console.log(`Cross chain messages were successful`);
                        } else {
                            console.log(`Cross chain messages were failed`);
                        }
                    }
                },
            });
            console.log(
                `Transferring: ${content.amount} tokens (${adjustedInputAmount} base units)`
            );

            if (callback) {
                callback({
                    text: `Successfully Bridged ${content.amount} ${content.token} to ${content.recipient}`,
                    content: {
                        success: true,
                        amount: content.amount,
                        recipient: content.recipient,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during token bridge:", error);
            if (callback) {
                callback({
                    text: `Error bridging tokens: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{name1}}",
                content: {
                    text: "Bridge 69 USDC tokens to 0x4f2e63be8e7fe287836e29cde6f3d5cbc96eefd0c0e3f3747668faa2ae7324b0 from arbitrum to base",
                },
            },
            {
                user: "{{name2}}",
                content: {
                    text: "I'll send 69 USDC tokens now... from: arbitrum, to: base",
                    action: "BRIDGE_DEPOSIT",
                },
            },
            {
                user: "{{name2}}",
                content: {
                    text: "Successfully bridged 69 APT tokens to 0x4f2e63be8e7fe287836e29cde6f3d5cbc96eefd0c0e3f3747668faa2ae7324b0, Transaction: 0x39a8c432d9bdad993a33cc1faf2e9b58fb7dd940c0425f1d6db3997e4b4b05c0",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
