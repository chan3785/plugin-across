import { privateKeyToAccount } from "viem/accounts";

import { createWalletClient, http, WalletClient, type Chain } from "viem";

export function createUserWalletClient(
    privateKey: `0x${string}`,
    chain: Chain
): WalletClient {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
        account,
        chain,
        transport: http(),
    });

    return walletClient;
}
