/* eslint-disable no-console */
import { describe, it } from "mocha";

import { BitcoinCash } from "../src";

describe("BCH", () => {
    it.only("address to buffer", () => {
        const bch = BitcoinCash();
        console.log(
            bch
                .addressStringToBytes(
                    "bchtest:pq35hhjj35we555szq8xsa47ry093mkasudz8aetvr",
                )
                .toString("hex"),
        );
    });
});