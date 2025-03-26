import { arbitrum, arbitrumSepolia, base } from "viem/chains";

export const supportedChains = [
    {
        chainName: "arbitrum",
        chainId: arbitrum.id,
        viemChain: arbitrum,
        tokenAddress: { usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    },
    {
        chainName: "base",
        chainId: base.id,
        viemChain: base,
        tokenAddress: { usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    },
];
