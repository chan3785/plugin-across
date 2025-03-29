import { type Chain } from "viem";

export function adjustInputAmountForOuput(
    inputAmout: bigint,
    b: bigint
): bigint {
    const SCAILING_FACTOR = BigInt(1e18);

    if (b > SCAILING_FACTOR) {
        throw new Error("Fraction b must not exceed 1e18 (100%)");
    }

    const adjustedInputAmount =
        (inputAmout * SCAILING_FACTOR) / (SCAILING_FACTOR - b);

    return adjustedInputAmount;
}

export function createTransactionUrl(chain: Chain, transactionHash: string) {
    if (!chain.blockExplorers) {
        throw new Error("Chain has no block explorers");
    }

    let blockExplorerUrl = chain.blockExplorers.default.url;

    if (!blockExplorerUrl.endsWith("/")) {
        blockExplorerUrl += "/";
    }

    return `${blockExplorerUrl}tx/${transactionHash}`;
}
