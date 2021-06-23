
import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, constants, ether, expectRevert } from "@openzeppelin/test-helpers";
import { DummyVanillaERC20Instance } from "../types/contracts"
import { PurposeInstance, DubiInstance } from "@prps/solidity/types/contracts";
import { packCollectibleData } from "@clashofstreamers/solidity/lib/utils";
import { expectBigNumber, mockHeroAttributes, CurrencyType, deployTestnet } from "./support";
import { DubiexDeployment } from "../src/types";
import { createSignedBoostedMakeOrderMessage, createSignedBoostedCancelOrderMessage, createSignedBoostedTakeOrderMessage } from "../src/utils";
import { ZERO } from "@prps/solidity/lib/types";

contract.fromArtifact("Dubiex");
const DummyVanillaERC20 = contract.fromArtifact("DummyVanillaERC20");

const [alice, bob, carl] = accounts;

let prps: PurposeInstance;
let dubi: DubiInstance;
let vanillaERC20Token: DummyVanillaERC20Instance;

let deployment: DubiexDeployment;

beforeEach(async () => {
    deployment = await deployTestnet();

    vanillaERC20Token = await DummyVanillaERC20.new();

    prps = deployment.Purpose;
    dubi = deployment.Dubi;
});

const getBalances = async (from: string, tokenId?): Promise<{ dubi: any, unlockedPrps: any, lockedPrps: any, empoweredDUBI: any }> => {
    return {
        dubi: await dubi.balanceOf(from),
        unlockedPrps: await prps.balanceOf(from),
        lockedPrps: await prps.hodlBalanceOf(from),
        empoweredDUBI: new BN((await deployment.Heroes.getCollectibleData(new BN(tokenId) ?? ZERO)).empoweredDUBI),
    };
}

describe("Fuel", () => {
    describe("Dubiex", () => {

        describe("boostedMakeOrder", () => {
            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("20"));
                await prps.mint(boostedAlice.address, ether("20"));

                // Can use DUBI fuel
                await expectMakeOrder(boostedAlice, { dubi: ether("5") }, 1);

                // Can use unlocked PRPS fuel
                await expectMakeOrder(boostedAlice, { unlockedPrps: ether("5") }, 2);

                // Can use locked PRPS fuel
                await deployment.Hodl.hodl(1, ether("10"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice 5 PRPS left
                await expectMakeOrder(boostedAlice, { lockedPrps: ether("5") }, 3);

                // Hodl half eaten
                let _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).burnedLockedPrps, ether("5"));

                await expectMakeOrder(boostedAlice, { lockedPrps: ether("5") }, 4);

                // Deleted
                _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).id, ZERO);

                // Export a token for alice and empower with 5 DUBI
                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("5"), "1");
                await expectMakeOrder(boostedAlice, { intrinsicFuel: ether("5") }, 5, {
                    makerContractAddress: deployment.Heroes.address,
                    makerCurrencyType: CurrencyType.ERC721,
                    makerValue: new BN(1),
                });
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // The booster might also waive the fuel
                await expectMakeOrder(boostedAlice, {}, 1);
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("2"));
                await prps.mint(boostedAlice.address, ether("4"));

                // Alice only has 2 DUBI, but she needs 5
                await expectRevert(expectMakeOrder(boostedAlice, { dubi: ether("5") }, 1), "DUBI-7");

                // Alice only has 4 unlocked PRPS, but she needs 5
                await expectRevert(expectMakeOrder(boostedAlice, { unlockedPrps: ether("5") }, 1), "PRPS-7");

                // Hodl 1 PRPS
                await deployment.Hodl.hodl(1, ether("1"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice only has 1 locked PRPS, but she needs 2 (unlocked PRPS is ignored)
                await expectRevert(expectMakeOrder(boostedAlice, { lockedPrps: ether("2") }, 1), "PRPS-7");

                // Export a token for alice and empower with 2 DUBI
                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("2"), "1");
                // Fuel is 3 DUBI and fails
                await expectRevert(expectMakeOrder(boostedAlice, { intrinsicFuel: ether("5") }, 5, {
                    makerContractAddress: deployment.Heroes.address,
                    makerCurrencyType: CurrencyType.ERC721,
                    makerValue: new BN(1),
                }), "COS-21");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("5"));
                await expectRevert(expectMakeOrder(boostedAlice, { dubi: ether("11") }, 1), "DUBI-5");
                await expectRevert(expectMakeOrder(boostedAlice, { unlockedPrps: ether("11") }, 1), "PRPS-10");
                await expectRevert(expectMakeOrder(boostedAlice, { lockedPrps: ether("11") }, 1), "PRPS-10");

                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("5"), "1");

                await expectRevert(expectMakeOrder(boostedAlice, { intrinsicFuel: ether("11") }, 5, {
                    makerContractAddress: deployment.Heroes.address,
                    makerCurrencyType: CurrencyType.ERC721,
                    makerValue: new BN(1),
                }), "COS-21");
            });
        });

        describe("boostedTakeOrder", () => {
            it("should burn fuel", async () => {
                const [boostedAlice, boostedBob] = deployment.boostedAddresses;

                const pair = {
                    // Use a vanilla ERC20 to simplify the balance calculations
                    makerCurrencyType: CurrencyType.ERC20,
                    makerContractAddress: vanillaERC20Token.address,
                    takerCurrencyType: CurrencyType.ETH,
                    takerContractAddress: constants.ZERO_ADDRESS,
                }

                // Mint some DUBI,  PRPS and VanillaERC20
                await vanillaERC20Token.mint(boostedAlice.address, ether("100"));
                await vanillaERC20Token.approve(deployment.Dubiex.address, ether("100"), { from: boostedAlice.address });

                await dubi.mint(boostedBob.address, ether("200"));
                await prps.mint(boostedBob.address, ether("20"));

                await expectMakeOrder(boostedAlice, {}, 1, pair);
                await expectMakeOrder(boostedAlice, {}, 2, pair);
                await expectMakeOrder(boostedAlice, {}, 3, pair);
                await expectMakeOrder(boostedAlice, {}, 4, pair);

                await expectMintedCollectibleWithApprovalAndDUBI(boostedBob.address, ether("6"), "1");
                await expectMakeOrder(boostedAlice, {}, 5, {
                    takerContractAddress: deployment.Heroes.address,
                    takerCurrencyType: CurrencyType.ERC721,
                    takerValue: new BN(1),
                });

                // Can use DUBI fuel
                await expectTakeOrder(boostedBob, boostedAlice, 1, { dubi: ether("5") }, 1);

                // Can use unlocked PRPS fuel
                await expectTakeOrder(boostedBob, boostedAlice, 2, { unlockedPrps: ether("5") }, 2);

                // Can use locked PRPS fuel
                await deployment.Hodl.hodl(1, ether("10"), 365, boostedBob.address, boostedBob.address, { from: boostedBob.address });

                // Bob 5 PRPS left
                await expectTakeOrder(boostedBob, boostedAlice, 3, { lockedPrps: ether("5") }, 3);

                // Hodl half eaten
                let _hodl = deployment.Hodl.getHodl(1, boostedBob.address, boostedBob.address);
                expectBigNumber((await _hodl).burnedLockedPrps, ether("5"));

                await expectTakeOrder(boostedBob, boostedAlice, 4, { lockedPrps: ether("5") }, 4);

                // Deleted
                _hodl = deployment.Hodl.getHodl(1, boostedBob.address, boostedBob.address);
                expectBigNumber((await _hodl).id, ZERO);

                // Take order with hero, which has 6 DUBI to use as intrinsic fuel
                await expectTakeOrder(boostedBob, boostedAlice, 5, { intrinsicFuel: ether("5") }, 5, 1);
            });

            it("should send without a fuel", async () => {
                const [boostedAlice, boostedBob] = deployment.boostedAddresses;

                await vanillaERC20Token.mint(boostedAlice.address, ether("200"));
                await vanillaERC20Token.approve(deployment.Dubiex.address, ether("10"), { from: boostedAlice.address });

                // The booster might also waive the fuel
                await expectMakeOrder(boostedAlice, {}, 1, {
                    makerCurrencyType: CurrencyType.ERC20,
                    makerContractAddress: vanillaERC20Token.address,
                    takerCurrencyType: CurrencyType.ETH,
                    takerContractAddress: constants.ZERO_ADDRESS,
                });

                await expectTakeOrder(boostedBob, boostedAlice, 1, {}, 1);
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice, boostedBob] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for bob
                await dubi.mint(boostedBob.address, ether("2"));
                await prps.mint(boostedBob.address, ether("4"));

                await expectMakeOrder(boostedAlice, {}, 1);

                // Bob only has 2 DUBI, but she needs 5
                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 1, { dubi: ether("5") }, 1), "DUBI-7");

                // Bob only has 4 unlocked PRPS, but she needs 5
                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 1, { unlockedPrps: ether("5") }, 1), "PRPS-7");

                // Hodl 1 PRPS
                await deployment.Hodl.hodl(1, ether("1"), 365, boostedBob.address, boostedBob.address, { from: boostedBob.address });

                // Bob only has 1 locked PRPS, but she needs 2 (unlocked PRPS is ignored)
                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 1, { lockedPrps: ether("2") }, 1), "PRPS-7");

                // Export a token for bob and empower with 4 DUBI
                await dubi.mint(boostedBob.address, ether("10"));
                await expectMintedCollectibleWithApprovalAndDUBI(boostedBob.address, ether("4"), "1");
                // Create maker order with alice for said token
                await expectMakeOrder(boostedAlice, {}, 2, {
                    takerContractAddress: deployment.Heroes.address,
                    takerCurrencyType: CurrencyType.ERC721,
                    takerValue: new BN(1),
                });
                // Take order fails, since the hero needs 5 DUBI
                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 2, { intrinsicFuel: ether("5") }, 4, 1), "COS-21");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice, boostedBob,] = deployment.boostedAddresses;

                await expectMakeOrder(boostedAlice, {}, 1);

                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 1, { dubi: ether("11") }, 1), "DUBI-5");
                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 1, { unlockedPrps: ether("11") }, 1), "PRPS-10");
                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 1, { lockedPrps: ether("11") }, 1), "PRPS-10");

                await dubi.mint(boostedBob.address, ether("10"));
                await expectMintedCollectibleWithApprovalAndDUBI(boostedBob.address, ether("10"), "1");
                await expectMakeOrder(boostedAlice, {}, 2, {
                    takerContractAddress: deployment.Heroes.address,
                    takerCurrencyType: CurrencyType.ERC721,
                    takerValue: new BN(1),
                });
                await expectRevert(expectTakeOrder(boostedBob, boostedAlice, 2, { intrinsicFuel: ether("11") }, 4, 1), "COS-21");
            });
        });

        describe("boostedCancelOrder", () => {
            it("should burn fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                const pair = {
                    // Use a vanilla ERC20 to simplify the balance calculations
                    makerCurrencyType: CurrencyType.ERC20,
                    makerContractAddress: vanillaERC20Token.address,
                    takerCurrencyType: CurrencyType.ETH,
                    takerContractAddress: constants.ZERO_ADDRESS,
                }

                // Mint some DUBI,  PRPS and VanillaERC20 for alice
                await vanillaERC20Token.mint(boostedAlice.address, ether("100"));
                await vanillaERC20Token.approve(deployment.Dubiex.address, ether("100"), { from: boostedAlice.address });

                await dubi.mint(boostedAlice.address, ether("200"));
                await prps.mint(boostedAlice.address, ether("20"));

                await expectMakeOrder(boostedAlice, {}, 1, pair);
                await expectMakeOrder(boostedAlice, {}, 2, pair);
                await expectMakeOrder(boostedAlice, {}, 3, pair);
                await expectMakeOrder(boostedAlice, {}, 4, pair);

                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("6"), "1");
                await expectMakeOrder(boostedAlice, {}, 5, {
                    makerContractAddress: deployment.Heroes.address,
                    makerCurrencyType: CurrencyType.ERC721,
                    makerValue: new BN(1),
                });

                // Can use DUBI fuel
                await expectCancelOrder(boostedAlice, 1, { dubi: ether("5") }, 6);

                // Can use unlocked PRPS fuel
                await expectCancelOrder(boostedAlice, 2, { unlockedPrps: ether("5") }, 7);

                // Can use locked PRPS fuel
                await deployment.Hodl.hodl(1, ether("10"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice 5 PRPS left
                await expectCancelOrder(boostedAlice, 3, { lockedPrps: ether("5") }, 8);

                // Hodl half eaten
                let _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).burnedLockedPrps, ether("5"));

                await expectCancelOrder(boostedAlice, 4, { lockedPrps: ether("5") }, 9);

                // Deleted
                _hodl = deployment.Hodl.getHodl(1, boostedAlice.address, boostedAlice.address);
                expectBigNumber((await _hodl).id, ZERO);

                // Cancel order with hero, which has 6 DUBI to use as intrinsic fuel
                await expectCancelOrder(boostedAlice, 5, { intrinsicFuel: ether("5") }, 10, 1);
            });

            it("should send without a fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("200"));

                // The booster might also waive the fuel
                await expectMakeOrder(boostedAlice, {}, 1);
                await expectCancelOrder(boostedAlice, 1, {}, 2);
            });

            it("should revert if out of fuel", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                // Mint some DUBI and PRPS for alice
                await dubi.mint(boostedAlice.address, ether("2"));
                await prps.mint(boostedAlice.address, ether("4"));

                await expectMakeOrder(boostedAlice, {}, 1);

                // Alice only has 2 DUBI, but she needs 5
                await expectRevert(expectCancelOrder(boostedAlice, 1, { dubi: ether("5") }, 2), "DUBI-7");

                // Alice only has 4 unlocked PRPS, but she needs 5
                await expectRevert(expectCancelOrder(boostedAlice, 1, { unlockedPrps: ether("5") }, 2), "PRPS-7");

                // Hodl 1 PRPS
                await deployment.Hodl.hodl(1, ether("1"), 365, boostedAlice.address, boostedAlice.address, { from: boostedAlice.address });

                // Alice only has 1 locked PRPS, but she needs 2 (unlocked PRPS is ignored)
                await expectRevert(expectCancelOrder(boostedAlice, 1, { lockedPrps: ether("2") }, 21), "PRPS-7");

                await dubi.mint(boostedAlice.address, ether("5"));
                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("3"), "1");
                await expectMakeOrder(boostedAlice, {}, 2, {
                    makerContractAddress: deployment.Heroes.address,
                    makerCurrencyType: CurrencyType.ERC721,
                    makerValue: new BN(1),
                });

                // Hero has 3 empowered DUBI, but cancel fuel is 4
                await expectRevert(expectCancelOrder(boostedAlice, 2, { intrinsicFuel: ether("4") }, 10, 2), "COS-21");
            });

            it("should revert if above MAX_BOOSTER_FUEL", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("5"));

                await expectMakeOrder(boostedAlice, {}, 1);
                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("3"), "1");
                await expectMakeOrder(boostedAlice, {}, 2, {
                    makerContractAddress: deployment.Heroes.address,
                    makerCurrencyType: CurrencyType.ERC721,
                    makerValue: new BN(1),
                });

                await expectRevert(expectCancelOrder(boostedAlice, 1, { dubi: ether("11") }, 3), "DUBI-5");
                await expectRevert(expectCancelOrder(boostedAlice, 1, { unlockedPrps: ether("11") }, 3), "PRPS-10");
                await expectRevert(expectCancelOrder(boostedAlice, 1, { lockedPrps: ether("11") }, 3), "PRPS-10");
                await expectRevert(expectCancelOrder(boostedAlice, 2, { intrinsicFuel: ether("11") }, 10, 3), "COS-21");
            });
        });

        describe("batch", () => {

            it("should correctly burn fuel when creating batch make order", async () => {
                const [boostedAlice] = deployment.boostedAddresses;

                await dubi.mint(boostedAlice.address, ether("200"));
                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("20"), "1");
                await expectMintedCollectibleWithApprovalAndDUBI(boostedAlice.address, ether("20"), "2");

                /*
                    makeOrders(
                        MakeOrder{
                            currency: ERC721,
                            fuel: {
                                intrinsic: 10
                            }
                        },
                        MakeOrder{
                            currency: ERC721,
                            fuel: {
                                intrinsic: 0.01
                            }
                        },
                    )

                    -> 10.01 fuel
                */

                const boost1 = await createSignedBoostedMakeOrderMessage(deployment.web3, {
                    makerCurrencyType: CurrencyType.ERC721,
                    makerContractAddress: deployment.Heroes.address,
                    takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
                    takerContractAddress: deployment.Dubi.address,
                    makerValue: new BN(1),
                    takerValue: ether("10"),
                    nonce: new BN(1),
                    verifyingContract: deployment.Dubiex.address,
                    fuel: {
                        intrinsicFuel: ether("10"),
                    },
                    booster: deployment.booster,
                    maker: boostedAlice.address,
                    signer: boostedAlice,
                });

                const boost2 = await createSignedBoostedMakeOrderMessage(deployment.web3, {
                    makerCurrencyType: CurrencyType.ERC721,
                    makerContractAddress: deployment.Heroes.address,
                    takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
                    takerContractAddress: deployment.Dubi.address,
                    makerValue: new BN(2),
                    takerValue: ether("10"),
                    nonce: new BN(2),
                    verifyingContract: deployment.Dubiex.address,
                    fuel: {
                        intrinsicFuel: ether("1").div(new BN(100)),
                    },
                    booster: deployment.booster,
                    maker: boostedAlice.address,
                    signer: boostedAlice,
                });

                // Total indirect fuel => 10.01

                // Before boost both collectibles have 20 empowered DUBI each
                expectBigNumber((await deployment.Heroes.getCollectibleData(1)).empoweredDUBI, ether("20"));
                expectBigNumber((await deployment.Heroes.getCollectibleData(2)).empoweredDUBI, ether("20"));
                expectBigNumber(await deployment.Dubiex.getNonce(boostedAlice.address), ZERO);

                await deployment.Dubiex.boostedMakeOrderBatch([boost1.message, boost2.message], [boost1.signature, boost2.signature], { from: deployment.booster });

                expectBigNumber(await deployment.Dubiex.getNonce(boostedAlice.address), ZERO);

                // After boost collectible 1 has 10 empowered DUBI
                expectBigNumber((await deployment.Heroes.getCollectibleData(1)).empoweredDUBI, ether("10"));
                // After boost collectible 2 has 19.90 empowered DUBI
                expectBigNumber((await deployment.Heroes.getCollectibleData(2)).empoweredDUBI, ether("1999").div(new BN(100)));
            });

            it("should correctly burn fuel when creating batch take order", async () => {
                const [boostedAlice, boostedBob] = deployment.boostedAddresses;

                await dubi.mint(boostedBob.address, ether("200"));
                await deployment.Purpose.mint(boostedBob.address, ether("200"));

                await expectMintedCollectibleWithApprovalAndDUBI(boostedBob.address, ether("20"), "1");
                await expectMintedCollectibleWithApprovalAndDUBI(boostedBob.address, ether("20"), "2");

                // Create 
                // 2 ERC721 buy orders
                // and 1 DUBI buy order

                await expectMakeOrder(boostedAlice, {}, 1, {
                    takerContractAddress: deployment.Heroes.address,
                    takerCurrencyType: CurrencyType.ERC721,
                    takerValue: new BN(1),
                });

                await expectMakeOrder(boostedAlice, {}, 2, {
                    takerContractAddress: deployment.Heroes.address,
                    takerCurrencyType: CurrencyType.ERC721,
                    takerValue: new BN(2),
                });

                // Sell ETH for DUBI
                await expectMakeOrder(boostedAlice, {}, 3);

                /*
                  takeOrders(
                        takeOrder{
                            currency: ERC20,
                            fuel: {
                                direct: 5
                            }
                        },
                        takeOrder{
                            currency: ERC721,
                            fuel: {
                                intrinsic: 10
                            }
                        },
                        takeOrder{
                            currency: ERC721,
                            fuel: {
                                intrinsic: 0.01
                            }
                        },
                        takeOrder{
                            currency: ERC20,
                            fuel: {
                                direct: 5
                            }
                        },
                    )
                */

                // Partially fill some of the DUBI buy order, unlockedPrps fuel = 5
                const boost1 = await createSignedBoostedTakeOrderMessage(deployment.web3, {
                    id: new BN(3),
                    taker: boostedBob.address,
                    takerValue: ether("1"),
                    nonce: new BN(1),
                    verifyingContract: deployment.Dubiex.address,
                    fuel: {
                        unlockedPrps: ether("5"),
                    },
                    booster: deployment.booster,
                    maker: boostedAlice.address,
                    signer: boostedBob,
                });

                // Fill first hero buy order, intriniscFee = 10
                const boost2 = await createSignedBoostedTakeOrderMessage(deployment.web3, {
                    id: new BN(1),
                    taker: boostedBob.address,
                    takerValue: new BN(1),
                    nonce: ZERO, // Doesn't change nonce
                    verifyingContract: deployment.Dubiex.address,
                    fuel: {
                        intrinsicFuel: ether("10"),
                    },
                    booster: deployment.booster,
                    maker: boostedAlice.address,
                    signer: boostedBob,
                });

                // Fill second hero buy order, intrinsicFee = 0.01
                const boost3 = await createSignedBoostedTakeOrderMessage(deployment.web3, {
                    id: new BN(2),
                    taker: boostedBob.address,
                    takerValue: new BN(2),
                    nonce: ZERO, // Doesn't change nonce
                    verifyingContract: deployment.Dubiex.address,
                    fuel: {
                        intrinsicFuel: ether("1").div(new BN(100)),
                    },
                    booster: deployment.booster,
                    maker: boostedAlice.address,
                    signer: boostedBob,
                });

                // Fill DUBI order again, unlockedPrps fuel = 0.01
                const boost4 = await createSignedBoostedTakeOrderMessage(deployment.web3, {
                    id: new BN(3),
                    taker: boostedBob.address,
                    takerValue: ether("1"),
                    nonce: new BN(2), // increases nonce
                    verifyingContract: deployment.Dubiex.address,
                    fuel: {
                        unlockedPrps: ether("1").div(new BN(100)),
                    },
                    booster: deployment.booster,
                    maker: boostedAlice.address,
                    signer: boostedBob,
                });

                // Total indirect fuel => 10.01
                // Total unlocked PRPS fuel => 5.01
                // Nonce is incremented twice

                // Before boost both collectibles have 20 empowered DUBI each
                expectBigNumber((await deployment.Heroes.getCollectibleData(1)).empoweredDUBI, ether("20"));
                expectBigNumber((await deployment.Heroes.getCollectibleData(2)).empoweredDUBI, ether("20"));
                expectBigNumber(await deployment.Purpose.balanceOf(boostedBob.address), ether("200"));
                expectBigNumber(await deployment.Dubiex.getNonce(boostedBob.address), ZERO);

                await deployment.Dubiex.boostedTakeOrderBatch([boost1.message, boost2.message, boost3.message, boost4.message], [boost1.signature, boost2.signature, boost3.signature, boost4.signature], { from: deployment.booster });

                // Nonce is now 2, since 2 collectible take orders don't increase the nonce
                expectBigNumber(await deployment.Dubiex.getNonce(boostedBob.address), new BN(2));

                // After boost, he 5.01 unlocked PRPS got burned as fuel
                expectBigNumber(await deployment.Purpose.balanceOf(boostedBob.address), ether("200").sub(ether("501").div(new BN(100))));
                // After boost collectible 1 has 10 empowered DUBI
                expectBigNumber((await deployment.Heroes.getCollectibleData(1)).empoweredDUBI, ether("10"));
                // After boost collectible 2 has 19.90 empowered DUBI
                expectBigNumber((await deployment.Heroes.getCollectibleData(2)).empoweredDUBI, ether("1999").div(new BN(100)));
            });

        });
    });
});

const expectMakeOrder = async (maker, fuel, nonce, pair?) => {
    const balancesBefore = await getBalances(maker.address, pair?.makerCurrencyType === CurrencyType.ERC721 ? pair.makerValue : undefined);

    const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        ...({
            makerCurrencyType: CurrencyType.ETH,
            makerContractAddress: constants.ZERO_ADDRESS,
            takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
            takerContractAddress: deployment.Dubi.address,
            makerValue: ether("10"),
            takerValue: ether("10"),
            ...pair,
        }),
        nonce: new BN(nonce),
        verifyingContract: deployment.Dubiex.address,
        fuel,
        booster: deployment.booster,
        maker: maker.address,
        signer: maker,
    });

    const receipt = await deployment.Dubiex.boostedMakeOrder(message, signature, { from: deployment.booster, value: ether("10") });
    // console.log(receipt.receipt.gasUsed);

    const balancesAfter = await getBalances(maker.address, pair?.makerCurrencyType === CurrencyType.ERC721 ? pair.makerValue : undefined);
    expectBalancesBeforeAfter(balancesBefore, balancesAfter, fuel);

    if (fuel.intrinsicFuel && pair?.makerCurrencyType === CurrencyType.ERC721) {
        // Check that empowered DUBI on hero has been subtracted by fuel
        expectBigNumber(balancesAfter.empoweredDUBI, balancesBefore.empoweredDUBI.sub(fuel.intrinsicFuel));
    }
}

const expectTakeOrder = async (taker, maker, orderId, fuel, nonce, tokenId?) => {
    const makerBalancesBefore = await getBalances(maker.address, tokenId);
    const takerBalancesBefore = await getBalances(taker.address, tokenId);

    const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
        id: orderId,
        taker: taker.address,
        takerValue: tokenId ?? ether("10"),
        nonce: new BN(nonce),
        verifyingContract: deployment.Dubiex.address,
        fuel,
        booster: deployment.booster,
        maker: maker.address,
        signer: taker,
    });

    const receipt = await deployment.Dubiex.boostedTakeOrder(message, signature, { from: deployment.booster, value: ether("10") });
    // console.log(receipt.receipt.gasUsed);

    const makerBalancesAfter = await getBalances(maker.address, tokenId);
    const takerBalancesAfter = await getBalances(taker.address, tokenId);

    // Maker token balances that can be used as fuel don't change
    // NOTE: all orders use the vanilla ERC20 or a ERC721 collectible
    expectBalancesBeforeAfter(makerBalancesBefore, makerBalancesAfter, {});

    // Taker token balances that can be used as fuel change
    expectBalancesBeforeAfter(takerBalancesBefore, takerBalancesAfter, fuel);

    if (fuel.intrinsicFuel && tokenId) {
        // Check that empowered DUBI on hero has been subtracted by fuel
        expectBigNumber(takerBalancesAfter.empoweredDUBI, takerBalancesBefore.empoweredDUBI.sub(fuel.intrinsicFuel));
    }
}

const expectCancelOrder = async (maker, orderId, fuel, nonce, tokenId?) => {
    const balancesBefore = await getBalances(maker.address, tokenId);

    const { message, signature } = await createSignedBoostedCancelOrderMessage(deployment.web3, {
        id: orderId,
        nonce: new BN(nonce),
        verifyingContract: deployment.Dubiex.address,
        fuel,
        booster: deployment.booster,
        maker: maker.address,
        signer: maker,
    });

    const receipt = await deployment.Dubiex.boostedCancelOrder(message, signature, { from: deployment.booster, value: ether("10") });
    // console.log(receipt.receipt.gasUsed);

    const balancesAfter = await getBalances(maker.address, tokenId);
    expectBalancesBeforeAfter(balancesBefore, balancesAfter, fuel);

    if (fuel.intrinsicFuel && tokenId) {
        // Check that empowered DUBI on hero has been subtracted by fuel
        expectBigNumber(balancesAfter.empoweredDUBI, balancesBefore.empoweredDUBI.sub(fuel.intrinsicFuel));
    }
}

const expectBalancesBeforeAfter = (before, after, fuel) => {
    if (fuel.dubi) {
        expectBigNumber(after.dubi, before.dubi.sub(fuel.dubi));
        expectBigNumber(after.unlockedPrps, before.unlockedPrps);
        expectBigNumber(after.lockedPrps, before.lockedPrps);
    } else if (fuel.unlockedPrps) {
        expectBigNumber(after.dubi, before.dubi);
        expectBigNumber(after.unlockedPrps, before.unlockedPrps.sub(fuel.unlockedPrps));
        expectBigNumber(after.lockedPrps, before.lockedPrps);
    } else if (fuel.lockedPrps) {
        expectBigNumber(after.dubi, before.dubi);
        expectBigNumber(after.unlockedPrps, before.unlockedPrps);
        expectBigNumber(after.lockedPrps, before.lockedPrps.sub(fuel.lockedPrps));
    } else {
        // Default is selling ETH so token balances dont change
        expectBigNumber(after.dubi, before.dubi);
        expectBigNumber(after.unlockedPrps, before.unlockedPrps);
        expectBigNumber(after.lockedPrps, before.lockedPrps);
    }
}

const expectMintedCollectibleWithApprovalAndDUBI = async (from, amount, tokenId) => {
    await expectMintCollectible(from, tokenId);

    await dubi.approve(deployment.Heroes.address, amount, { from });
    await deployment.Heroes.setApprovalForAll(deployment.Dubiex.address, true, { from });
    await deployment.Heroes.empower(tokenId, amount.toString(), {
        from,
        gas: 350_000,
    });
}

const expectMintCollectible = async (owner: string, tokenId: number) => {
    const attributes = mockHeroAttributes({});
    const packedData = packCollectibleData(deployment.Heroes, deployment, attributes);

    await deployment.Heroes.mint(tokenId, owner, packedData.toString(), [], [], { from: deployment.owner, gas: 1_000_000 });
}
