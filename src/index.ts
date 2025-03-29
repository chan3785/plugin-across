import { Plugin } from "@elizaos/core";
import deposit from "./actions/deposit";

export const Across: Plugin = {
    name: "across",
    description: "Cross chain service provider plugin.",
    actions: [
        deposit
    ],
    evaluators: [
        // evaluator here
    ],
    providers: [
        // providers here
    ],
};
