import { type Address } from "viem";
import { z } from "zod";

export const addressSchema = z.custom<Address>(
    (val) => {
        return typeof val === "string" && /^0x[a-fA-F0-9]$/.test(val);
    },
    { message: "Invalid address" }
);
