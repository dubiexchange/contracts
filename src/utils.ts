import { BoostedMakeOrder, BoostedTakeOrder, BoostedCancelOrder, MakeOrderInput, TakeOrderInput, OrderPair, CancelOrderInput } from "./types";
import { createEIP712Domain, blockchainTimestampWithOffset, signEIP712, getTypedMessageBytes } from "@prps/solidity/lib/utils";
import { EIP712Domain, BoosterFuel, BoosterPayload, ZERO, EIP712SignedMessage } from "@prps/solidity/lib/types";
import { TypedDataUtils } from "eth-sig-util";
import BN from "bn.js";

export const unpackPackedDataFromOrderEvent = (packedData): { makerValue: any, takerValue: any, orderPairAlias: number } => {
    const bitmask96 = new BN(2).pow(new BN(96)).sub(new BN(1));
    const bitmask32 = new BN(2).pow(new BN(32)).sub(new BN(1));

    return {
        makerValue: packedData.and(bitmask96),
        takerValue: packedData.shrn(96).and(bitmask96),
        orderPairAlias: (packedData.shrn(192).and(bitmask32)).toNumber(),
    }
}

export const packDataFromOrderEvent = (makerValue: any, takerValue: any, orderPairAlias: any): any => {
    const bitmask96 = new BN(2).pow(new BN(96)).sub(new BN(1));
    const bitmask32 = new BN(2).pow(new BN(32)).sub(new BN(1));

    const packedData = new BN(0)
        .ior(makerValue.and(bitmask96))
        .ior(takerValue.and(bitmask96).shln(96))
        .ior(new BN(orderPairAlias).and(bitmask32).shln(192));

    return packedData;
}

export const createSignedBoostedMakeOrderMessage = async (web3, { makerValue, takerValue, makerContractAddress, takerContractAddress, makerCurrencyType, takerCurrencyType, maker, orderId, ancestorOrderId, updatedRatioWei, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: { makerValue: BN; takerValue: BN; makerContractAddress: string; takerContractAddress: string; makerCurrencyType: number, takerCurrencyType: number; maker: string, orderId?: BN; ancestorOrderId?: BN; updatedRatioWei?: BN; nonce: BN; timestamp?: number, isLegacySignature?: boolean; fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string, verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            MakeOrderInput,
            OrderPair,
            BoostedMakeOrder,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Dubiex", verifyingContract),
        primaryType: "BoostedMakeOrder",
        message: {
            input: {
                makerValue: makerValue.toString(),
                takerValue: takerValue.toString(),
                pair: {
                    makerContractAddress,
                    takerContractAddress,
                    makerCurrencyType,
                    takerCurrencyType,
                },
                orderId: (orderId || ZERO).toString(),
                ancestorOrderId: (ancestorOrderId || ZERO).toString(),
                updatedRatioWei: (updatedRatioWei || ZERO).toString(),
            },
            maker,
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.intrinsicFuel ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}

export const createSignedBoostedTakeOrderMessage = async (web3, { id, maker, taker, takerValue, maxTakerMakerRatio, nonce, timestamp, isLegacySignature, fuel, booster, verifyingContract, signer: { privateKey } }: { id: BN; takerValue: BN; maker: string; taker: string; maxTakerMakerRatio?: any, isLegacySignature?: boolean; nonce: BN; timestamp?: number, fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string, verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            TakeOrderInput,
            BoostedTakeOrder,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Dubiex", verifyingContract),
        primaryType: "BoostedTakeOrder",
        message: {
            input: {
                id: id.toString(),
                maker,
                takerValue: takerValue.toString(),
                maxTakerMakerRatio: (maxTakerMakerRatio || new BN("1000000000000000000")).toString(),
            },
            taker,
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.intrinsicFuel ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}

export const createSignedBoostedCancelOrderMessage = async (web3, { id, maker, nonce, timestamp, fuel, booster, isLegacySignature, verifyingContract, signer: { privateKey } }: { id: BN; maker: string; nonce: BN; timestamp?: number, isLegacySignature?: boolean; fuel?: { dubi?: BN, unlockedPrps?: BN, lockedPrps?: BN, intrinsicFuel?: BN }, booster: string, verifyingContract: string, signer: { privateKey: string }; }): Promise<EIP712SignedMessage> => {
    const typedData = {
        types: {
            EIP712Domain,
            CancelOrderInput,
            BoostedCancelOrder,
            BoosterFuel,
            BoosterPayload,
        } as any,
        domain: createEIP712Domain("Dubiex", verifyingContract),
        primaryType: "BoostedCancelOrder",
        message: {
            input: {
                id: id.toString(),
                maker,
            },
            fuel: {
                dubi: (fuel?.dubi ?? 0).toString(),
                unlockedPrps: (fuel?.unlockedPrps ?? 0).toString(),
                lockedPrps: (fuel?.lockedPrps ?? 0).toString(),
                intrinsicFuel: (fuel?.intrinsicFuel ?? 0).toString(),
            },
            boosterPayload: {
                booster,
                timestamp: timestamp ?? await blockchainTimestampWithOffset(web3, 0),
                nonce: nonce.toString(),
                isLegacySignature: (isLegacySignature || false),
            }
        }
    };

    return {
        message: typedData.message,
        signature: signEIP712(typedData, { privateKey }),
        messageBytes: getTypedMessageBytes(web3, typedData),
        messageHash: `0x${TypedDataUtils.sign(typedData).toString("hex")}`,
    };
}
