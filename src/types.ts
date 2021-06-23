import { CosDeployment } from "@clashofstreamers/solidity/lib/types";
import { DubiexInstance } from "../types/contracts";

export interface DubiexDeployment extends CosDeployment {
    Dubiex: DubiexInstance,
}

// EIP712

export const MakeOrderInput = [
    { name: "makerValue", type: "uint96" },
    { name: "takerValue", type: "uint96" },
    { name: "pair", type: "OrderPair" },
    { name: "orderId", type: "uint32" },
    { name: "ancestorOrderId", type: "uint32" },
    { name: "updatedRatioWei", type: "uint128" },
]

export const OrderPair = [
    { name: "makerContractAddress", type: "address" },
    { name: "takerContractAddress", type: "address" },
    { name: "makerCurrencyType", type: "uint8" },
    { name: "takerCurrencyType", type: "uint8" },
]

export const TakeOrderInput = [
    { name: "id", type: "uint32" },
    { name: "maker", type: "address" },
    { name: "takerValue", type: "uint96" },
    { name: "maxTakerMakerRatio", type: "uint256" },
]

export const CancelOrderInput = [
    { name: "id", type: "uint32" },
    { name: "maker", type: "address" },
]

export const BoostedMakeOrder = [
    { name: "input", type: "MakeOrderInput" },
    { name: "maker", type: "address" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" }
]

export const BoostedTakeOrder = [
    { name: "input", type: "TakeOrderInput" },
    { name: "taker", type: "address" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" }
]

export const BoostedCancelOrder = [
    { name: "input", type: "CancelOrderInput" },
    { name: "fuel", type: "BoosterFuel" },
    { name: "boosterPayload", type: "BoosterPayload" }
]
