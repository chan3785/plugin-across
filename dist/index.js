// src/actions/deposit.ts
import { elizaLogger, generateObjectDeprecated } from "@elizaos/core";
import {
  ModelClass
} from "@elizaos/core";
import { composeContext } from "@elizaos/core";

// src/viem.ts
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
function createUserWalletClient(privateKey, chain) {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http()
  });
  return walletClient;
}

// src/actions/deposit.ts
import { createAcrossClient } from "@across-protocol/app-sdk";
import { parseUnits } from "viem";

// src/environments.ts
function adjustInputAmountForOuput(inputAmout, b) {
  const SCAILING_FACTOR = BigInt(1e18);
  if (b > SCAILING_FACTOR) {
    throw new Error("Fraction b must not exceed 1e18 (100%)");
  }
  const adjustedInputAmount = inputAmout * SCAILING_FACTOR / (SCAILING_FACTOR - b);
  return adjustedInputAmount;
}
function createTransactionUrl(chain, transactionHash) {
  if (!chain.blockExplorers) {
    throw new Error("Chain has no block explorers");
  }
  let blockExplorerUrl = chain.blockExplorers.default.url;
  if (!blockExplorerUrl.endsWith("/")) {
    blockExplorerUrl += "/";
  }
  return `${blockExplorerUrl}tx/${transactionHash}`;
}

// src/constants.ts
import { arbitrumSepolia, sepolia } from "viem/chains";
var supportedChains = [
  {
    chainName: "sepolia",
    chainId: sepolia.id,
    viemChain: sepolia,
    tokenAddress: { weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" }
  },
  {
    chainName: "arbitrum sepolia",
    chainId: arbitrumSepolia.id,
    viemChain: arbitrumSepolia,
    tokenAddress: { weth: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" }
  }
];

// src/actions/deposit.ts
function isValidAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}
function isDepositContent(content) {
  console.log("Content for Bridge", content);
  return isValidAddress(content.recipient) && // 수신자 주소가 문자열인지 확인
  (typeof content.amount === "string" || typeof content.amount === "number") && // 금액이 문자열 또는 bigint인지 확인
  typeof content.sourceChain === "string" && // 출발 체인 이름이 문자열인지 확인
  typeof content.destinationChain === "string" && // 도착 체인 이름이 문자열인지 확인
  typeof content.tokenName === "string";
}
var depositTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "recipient": "0x2badda48c062e861ef17a96a806c451fd296a49f45b272dee17f85b0e32663fd",
    "amount": "1000",
    "sourceChain": "arbitrum",
    "destinationChain": "base",
    "tokenName": "USDC",
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
var deposit_default = {
  name: "BRIDGE_DEPOSIT",
  // 액션 이름
  similes: ["DEPOSIT", "BRIDGE_TOKEN", "SEND", "bridge", "Bridge", "BRIDGE"],
  // 이 액션을 트리거할 수 있는 유사 표현
  validate: async (runtime, message) => {
    console.log("Validating bridging from user:", message.userId);
    return true;
  },
  description: "Transfer tokens from the agent's wallet to another address",
  // 액션 설명
  handler: async (runtime, message, state, _options, callback) => {
    console.log("Starting BRIDGE_DEPOSIT handler...");
    if (!state) {
      state = await runtime.composeState(message);
    }
    const depositContext = composeContext({
      state,
      template: depositTemplate
    });
    const content = await generateObjectDeprecated({
      runtime,
      context: depositContext,
      modelClass: ModelClass.SMALL
      // 작은 모델 사용
    });
    console.log("content generate", content);
    if (!isDepositContent(content)) {
      console.error("Invalid content for BRIDGE_DEPOSIT action.");
      if (callback) {
        callback({
          text: "Unable to process bridge request. Invalid content provided.",
          // 오류 메시지
          content: { error: "Invalid transfer content" }
        });
      }
      return false;
    }
    try {
      const sourceChainName = content.sourceChain;
      const destinationChainName = content.destinationChain;
      const WETH_DECIMALS = 18;
      const inputAmount = parseUnits(
        content.amount.toString(),
        WETH_DECIMALS
      );
      const privateKey = runtime.getSetting("ACROSS_PRIVATE_KEY");
      console.log("privateKey: ", privateKey);
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
          destinationChainConfig.viemChain
        ],
        useTestnet: true
      });
      const route = {
        originChainId: sourceChainConfig.chainId,
        destinationChainId: destinationChainConfig.chainId,
        inputToken: sourceChainConfig.tokenAddress.weth,
        outputToken: destinationChainConfig.tokenAddress.weth,
        isNative: true
      };
      console.log("Route", route);
      const quote = await acrossClient.getQuote({
        route,
        inputAmount
      });
      const adjustedInputAmount = adjustInputAmountForOuput(
        inputAmount,
        quote.fees.totalRelayFee.pct
      );
      const depositParams = {
        ...quote.deposit,
        recipient: content.recipient,
        inputAmount: adjustedInputAmount,
        outputAmount: inputAmount
      };
      console.log("depositParams:", depositParams);
      let sourceTxHash;
      let destinationTxHash;
      await acrossClient.executeQuote({
        walletClient: wallet,
        deposit: depositParams,
        onProgress: (progress) => {
          if (progress.step === "approve" && progress.status === "txSuccess") {
            const { txReceipt } = progress;
            console.log(
              `Approved ${sourceChainConfig.tokenAddress.weth} on ${sourceChainConfig.viemChain.name}`
            );
            console.log(
              createTransactionUrl(
                sourceChainConfig.viemChain,
                txReceipt.transactionHash
              )
            );
          }
          if (progress.step === "deposit" && progress.status === "txSuccess") {
            const { depositId, txReceipt } = progress;
            console.log(
              `Deposited ${sourceChainConfig.tokenAddress.weth} on ${sourceChainConfig.viemChain.name}`
            );
            elizaLogger.log(
              createTransactionUrl(
                sourceChainConfig.viemChain,
                txReceipt.transactionHash
              )
            );
            sourceTxHash = createTransactionUrl(sourceChainConfig.viemChain, txReceipt.transactionHash);
          }
          if (progress.step === "fill" && progress.status === "txSuccess") {
            const { txReceipt, actionSuccess } = progress;
            console.log(
              `Filled on ${destinationChainConfig.viemChain.name}`
            );
            console.log(
              createTransactionUrl(
                destinationChainConfig.viemChain,
                txReceipt.transactionHash
              )
            );
            destinationTxHash = createTransactionUrl(
              destinationChainConfig.viemChain,
              txReceipt.transactionHash
            );
            console.log("actionSuccess: ", actionSuccess);
            if (actionSuccess) {
              console.log(`Cross chain messages were successful`);
            } else {
              console.log(`Cross chain messages failed`);
            }
          }
        }
      });
      console.log(
        `Transferring: ${content.amount} tokens (${adjustedInputAmount} base units)`
      );
      if (callback) {
        callback({
          text: `Successfully Bridged ${content.amount} ${content.tokenName} to ${content.recipient}, source chain Tx: ${sourceTxHash}, destination chain Tx: ${destinationTxHash}`,
          // 성공 메시지
          content: {
            success: true,
            amount: content.amount,
            recipient: content.recipient,
            sourceChain: content.sourceChain,
            destinationChain: content.destinationChain,
            token: content.tokenName
          }
        });
      }
      return true;
    } catch (error) {
      console.error("Error during token bridge:", error);
      if (callback) {
        callback({
          text: `Error bridging tokens: ${error.message}`,
          // 오류 메시지
          content: { error: error.message }
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
          text: "Bridge 69 USDC tokens to 0x4f2e63be8e7fe287836e29cde6f3d5cbc96eefd0c0e3f3747668faa2ae7324b0 from arbitrum to base"
        }
      },
      {
        user: "{{name2}}",
        content: {
          text: "I'll send 69 USDC tokens now... from: arbitrum, to: base",
          action: "BRIDGE_DEPOSIT"
        }
      },
      {
        user: "{{name2}}",
        content: {
          text: "Successfully bridged 69 USDC tokens to 0x4f2e63be8e7fe287836e29cde6f3d5cbc96eefd0c0e3f3747668faa2ae7324b0, Transaction: 0x39a8c432d9bdad993a33cc1faf2e9b58fb7dd940c0425f1d6db3997e4b4b05c0"
        }
      }
    ]
  ]
};

// src/index.ts
var Across = {
  name: "across",
  description: "Cross chain service provider plugin.",
  actions: [
    deposit_default
  ],
  evaluators: [
    // evaluator here
  ],
  providers: [
    // providers here
  ]
};
export {
  Across
};
//# sourceMappingURL=index.js.map