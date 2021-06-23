import { accounts, contract } from "@openzeppelin/test-environment";
import { BN, constants, expectEvent, expectRevert, ether } from "@openzeppelin/test-helpers";
import { expectBigNumber, CurrencyType, mockHeroAttributes, expectBigNumberApprox, createOrderPairHash, deployTestnet } from "./support";

import { expect } from "chai";
import { DummyVanillaERC20Instance, DummyVanillaERC721Instance } from "../types/contracts";
import { DubiexDeployment } from "../src/types";
import { OptInInstance } from "@prps/solidity/types/contracts";
import { ZERO } from "@prps/solidity/lib/types";
import { packCollectibleData } from "@clashofstreamers/solidity/lib/utils";

import { createSignedBoostedCancelOrderMessage, createSignedBoostedMakeOrderMessage, createSignedBoostedTakeOrderMessage, packDataFromOrderEvent, unpackPackedDataFromOrderEvent } from "../src/utils";

const [alice, bob, charlie] = accounts;

const DummyVanillaERC20 = contract.fromArtifact("DummyVanillaERC20");
const DummyVanillaERC721 = contract.fromArtifact("DummyVanillaERC721");

let deployment: DubiexDeployment;
let defaultSender: string;
let optIn: OptInInstance;

let vanillaERC20Token: DummyVanillaERC20Instance;
let vanillaERC721Token: DummyVanillaERC721Instance;

beforeEach(async () => {
  deployment = await deployTestnet();
  defaultSender = deployment.owner;
  optIn = deployment.OptIn;

  vanillaERC20Token = await DummyVanillaERC20.new();

  // Create vanilla ERC721 token (non-fork)
  vanillaERC721Token = await DummyVanillaERC721.new();
});

export interface Order {
  id: any,
  orderId?: any,
  ancestorOrderId?: any,
  successorOrderId?: any,
  maker: string,
  makerValue: any,
  takerValue: any,
  makerContractAddress: string,
  takerContractAddress: string,
  makerCurrencyType: CurrencyType,
  takerCurrencyType: CurrencyType,
  ratio?: any,
  signer?: string,
  nonce?: any,
  boosterSignature?: string,
}

describe("Dubiex", () => {

  const makeFixtures: any[] = [
    {
      caption: "ERC20",
      init: async () => {
        return vanillaERC20Token.mint(alice, ether("100"));
      },
      new: () => ({
        makerCurrencyType: CurrencyType.ERC20,
        makerContractAddress: vanillaERC20Token.address,
        makerValue: ether("10"),
      }),
      makeOrderDetails: {
        from: alice,
      },
      revertReason: "ERC20: transfer amount exceeds balance",
    },
    {
      caption: "BoostableERC20",
      init: async () => {
        return deployment.Purpose.mint(alice, ether("100"));
      },
      new: () => ({
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Purpose.address,
        makerValue: ether("10"),
      }),
      makeOrderDetails: {
        from: alice,
      },
      revertReason: "ERC20-10",
    },
    {
      caption: "BoostableERC20-as-ERC20",
      init: async () => {
        return deployment.Purpose.mint(alice, ether("100"));
      },
      new: () => ({
        makerCurrencyType: CurrencyType.ERC20,
        makerContractAddress: deployment.Purpose.address,
        makerValue: ether("10"),
      }),
      makeOrderDetails: {
        from: alice,
      },
      revertReason: "ERC20-10",
    },
    {
      caption: "ERC721",
      init: async () => {
        return expectCreateCollectible(1, alice);
      },
      new: () => ({
        makerCurrencyType: CurrencyType.ERC721,
        makerContractAddress: deployment.Heroes.address,
        makerValue: new BN("1"),
      }),
      makeOrderDetails: {
        from: alice,
      },
      revertReason: "ERC721-6",
    },
    {
      caption: "ERC721-Vanilla",
      init: async () => {
        return vanillaERC721Token.mint(alice, 1, { from: defaultSender });
      },
      new: () => ({
        makerCurrencyType: CurrencyType.ERC721,
        makerContractAddress: vanillaERC721Token.address,
        makerValue: new BN("1"),
      }),
      makeOrderDetails: {
        from: alice,
      },
      revertReason: "ERC721: operator query for nonexistent token",
    },
    {
      caption: "ETH",
      init: async () => { },
      new: () => ({
        makerCurrencyType: CurrencyType.ETH,
        makerContractAddress: constants.ZERO_ADDRESS,
        makerValue: ether("5"),
      }),
      makeOrderDetails: {
        from: alice,
        value: ether("5"),
      },
      revertReason: "Dubiex: failed to deposit. not enough funds?",
    },
  ]

  const takeFixtures: any[] = [
    {
      caption: "ERC20",
      init: async () => {
        return vanillaERC20Token.mint(bob, ether("100"));
      },
      new: () => ({
        takerCurrencyType: CurrencyType.ERC20,
        takerContractAddress: vanillaERC20Token.address,
        takerValue: ether("10"),
      }),
      takeOrderDetails: {
        from: bob,
      },
      revertReason: "ERC20: transfer amount exceeds balance",
    }, {
      caption: "BoostableERC20-as-ERC20",
      init: async () => {
        return deployment.Purpose.mint(bob, ether("100"));
      },
      new: () => ({
        takerCurrencyType: CurrencyType.ERC20,
        takerContractAddress: deployment.Purpose.address,
        takerValue: ether("10"),
      }),
      takeOrderDetails: {
        from: bob,
      },
      revertReason: "ERC20-10",
    },
    {
      caption: "BoostableERC20",
      init: async () => {
        return deployment.Dubi.mint(bob, ether("100"));
      },
      new: () => ({
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      }),
      takeOrderDetails: {
        from: bob,
      },
      revertReason: "ERC20-10",
    },
    {
      caption: "ERC721",
      init: async () => {
        return expectCreateCollectible(2, bob);
      },
      new: () => ({
        takerCurrencyType: CurrencyType.ERC721,
        takerContractAddress: deployment.Heroes.address,
        takerValue: new BN("2"),
      }),
      takeOrderDetails: {
        from: bob,
      },
      revertReason: "ERC721-6",
    }, {
      caption: "ERC721-Vanilla",
      init: async () => {
        return vanillaERC721Token.mint(bob, 2, { from: defaultSender });
      },
      new: () => ({
        takerCurrencyType: CurrencyType.ERC721,
        takerContractAddress: vanillaERC721Token.address,
        takerValue: new BN("2"),
      }),
      takeOrderDetails: {
        from: bob,
      },
      revertReason: "ERC721: operator query for nonexistent token",
    }, {
      caption: "ETH",
      init: async () => { },
      new: () => ({
        takerCurrencyType: CurrencyType.ETH,
        takerContractAddress: constants.ZERO_ADDRESS,
        takerValue: ether("5"),
      }),
      takeOrderDetails: {
        from: bob,
        value: ether("5"),
      },
      revertReason: "Dubiex: failed to transfer value to maker",
    }
  ];

  for (const makeFixture of makeFixtures) {
    describe(makeFixture.caption, () => {

      for (const takeFixture of takeFixtures) {
        describe(takeFixture.caption, () => {
          it("should make an order", async () => {
            await makeFixture.init();

            const makeOrder = {
              id: new BN(1),
              maker: alice,
              ...makeFixture.new(),
              ...takeFixture.new(),
            };

            await expectMakeOrder(makeOrder, makeFixture.makeOrderDetails);
          });

          it("should take an order", async () => {
            const makeOrder = {
              id: new BN(1),
              maker: alice,
              ...makeFixture.new(),
              ...takeFixture.new(),
            };

            await makeFixture.init();
            await takeFixture.init();

            await expectMakeOrder(makeOrder, makeFixture.makeOrderDetails);
            await expectTakeOrder({
              maker: makeOrder.maker,
              id: makeOrder.id, takerValue: makeOrder.takerValue, txDetails: {
                ...takeFixture.takeOrderDetails,
                value: takeFixture.takeOrderDetails.value,
              }
            });
          });

          it("should cancel an order", async () => {
            const makeOrder = {
              id: new BN(1),
              maker: alice,
              ...makeFixture.new(),
              ...takeFixture.new(),
            };

            await makeFixture.init();
            await takeFixture.init();

            await expectMakeOrder(makeOrder, makeFixture.makeOrderDetails);
            await expectCancelOrder(makeOrder.maker, makeOrder.id, {
              ...makeFixture.makeOrderDetails,
              value: undefined,
            });
          });

          it("should update an order", async () => {
            const makeOrder = {
              id: new BN(1),
              maker: alice,
              ...makeFixture.new(),
              ...takeFixture.new(),
            };

            await makeFixture.init();
            await takeFixture.init();

            await expectMakeOrder(makeOrder, makeFixture.makeOrderDetails);

            // Can only upsert if the order doesn't have any ERC721
            if (makeOrder.takerCurrencyType !== CurrencyType.ERC721 && makeOrder.makerCurrencyType !== CurrencyType.ERC721) {
              await expectUpdateOrder({
                ...makeOrder,
                orderId: new BN(1),
                ratio: ether("2")
              }, makeOrder.makerValue.mul(new BN("2")), { ...makeFixture.makeOrderDetails });
            } else {
              await expectRevert(expectUpdateOrder({ ...makeOrder, ratio: ether("2"), orderId: new BN(1) }, makeOrder.makerValue.mul(new BN("2")), { ...makeFixture.makeOrderDetails }), "Dubiex: cannot update ERC721 value");
            }
          });

          it("should revert makeOrder with insufficient balance", async () => {
            const makeOrder = {
              id: new BN(1),
              ...makeFixture.new(),
              ...takeFixture.new(),
              makerValue: ether("99999999999"),
            };

            await expectApprove(makeOrder.makerContractAddress, makeOrder.makerCurrencyType, makeOrder.makerValue, { from: makeFixture.makeOrderDetails.from });

            await expectRevert(deployment.Dubiex.makeOrder({
              makerValue: makeOrder.makerValue.toString(),
              takerValue: makeOrder.takerValue.toString(),
              pair: {
                makerContractAddress: makeOrder.makerContractAddress,
                takerContractAddress: makeOrder.takerContractAddress,
                makerCurrencyType: makeOrder.makerCurrencyType,
                takerCurrencyType: makeOrder.takerCurrencyType,
              },
              orderId: 0,
              ancestorOrderId: 0,
              updatedRatioWei: 0,
            },
              makeFixture.makeOrderDetails,
            ),
              makeFixture.revertReason,
            );

          });

          it("should revert takeOrder with insufficient balance", async () => {
            const makeOrder = {
              id: new BN(1),
              maker: alice,
              ...makeFixture.new(),
              ...takeFixture.new(),
            };

            await makeFixture.init();
            await expectMakeOrder(makeOrder, makeFixture.makeOrderDetails);

            await expectApprove(makeOrder.takerContractAddress, makeOrder.takerCurrencyType, makeOrder.takerValue, { from: takeFixture.takeOrderDetails.from });

            await expectRevert(deployment.Dubiex.takeOrder({
              id: makeOrder.id.toString(),
              maker: makeOrder.maker,
              takerValue: makeOrder.takerValue.toString(),
              maxTakerMakerRatio: (makeOrder.takerValue.mul(ether("1")).div(makeOrder.makerValue)).toString(),
            }, {
              ...takeFixture.takeOrderDetails,
              value: undefined,
            }),
              takeFixture.revertReason,
            );

          });

          it("should partially fill order except ERC721", async () => {
            const makeOrder = {
              id: new BN(1),
              maker: alice,
              ...makeFixture.new(),
              ...takeFixture.new(),
            };

            await makeFixture.init();
            await takeFixture.init();

            await expectMakeOrder(makeOrder, makeFixture.makeOrderDetails);

            const maxTakerMakerRatio = (makeOrder.takerValue.mul(ether("1")).div(makeOrder.makerValue)).toString();
            const halfTakerValue = makeOrder.takerValue.div(new BN(2));
            const halfMakerValue = makeOrder.makerValue.div(new BN(2));

            if (makeOrder.makerCurrencyType !== CurrencyType.ERC721 && makeOrder.takerCurrencyType !== CurrencyType.ERC721) {
              const { value } = takeFixture.takeOrderDetails as any;
              const halfValue = value ? value.div(new BN(2)) : value;

              await expectTakeOrder({
                id: makeOrder.id, maker: makeOrder.maker, takerValue: halfTakerValue, txDetails: {
                  ...takeFixture.takeOrderDetails,
                  value: halfValue,
                },
                maxTakerMakerRatio: maxTakerMakerRatio,
              });

              let order = await getOrder(makeOrder.maker, makeOrder.id);
              expectBigNumber(order.makerValue, halfMakerValue);
              expectBigNumber(order.takerValue, halfTakerValue);

              await expectTakeOrder({
                id: makeOrder.id, maker: makeOrder.maker, takerValue: halfTakerValue, txDetails: {
                  ...takeFixture.takeOrderDetails,
                  value: halfValue,
                },
                maxTakerMakerRatio: maxTakerMakerRatio,
              });

              order = await getOrder(makeOrder.maker, makeOrder.id);
              expectBigNumber(order.makerValue, ZERO);
              expectBigNumber(order.takerValue, ZERO);
            } else {
              // ERC721 orders cannot be filled partially
              await expectRevert(deployment.Dubiex.takeOrder({
                id: makeOrder.id.toString(),
                maker: makeOrder.maker,
                takerValue: halfTakerValue.toString(),
                maxTakerMakerRatio: maxTakerMakerRatio,
              }, {
                ...takeFixture.takeOrderDetails,
                value: undefined,
              },
              ),
                "Dubiex: invalid takerValue"
              );
            }
          });
        });
      }
    });
  };

  describe("Dubiex - MakeOrder Pairs", () => {
    const makeOrder = () => ({
      id: new BN(1),
      makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
      makerContractAddress: deployment.Dubi.address,
      makerValue: ether("1"),
      takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
      takerContractAddress: deployment.Purpose.address,
      takerValue: ether("1"),
    });

    const testVector = () => [
      /* ETH */
      { currencyType: CurrencyType.ETH, contractAddress: deployment.Dubi.address, revertReason: "Dubiex: expected zero address" },
      // Eth passes correctly
      { currencyType: CurrencyType.ETH, contractAddress: constants.ZERO_ADDRESS, revertReason: "Dubiex: failed to deposit. not enough funds?" },

      /* ERC721 */
      { currencyType: CurrencyType.ERC721, contractAddress: deployment.Dubi.address, revertReason: "revert" },
      { currencyType: CurrencyType.ERC721, contractAddress: deployment.Dubiex.address, revertReason: "revert" },
      { currencyType: CurrencyType.ERC721, contractAddress: vanillaERC20Token.address, revertReason: "revert" },
      { currencyType: CurrencyType.ERC721, contractAddress: constants.ZERO_ADDRESS, revertReason: "revert" },
      // Heroes and Pets pass correctly
      { currencyType: CurrencyType.ERC721, contractAddress: deployment.Heroes.address, revertReason: "revert" },
      { currencyType: CurrencyType.ERC721, contractAddress: deployment.Pets.address, revertReason: "revert" },

      /* BOOSTABLE ERC20 */
      { currencyType: CurrencyType.BOOSTABLE_ERC20, contractAddress: deployment.Dubiex.address, revertReason: "Dubiex: not BoostableERC20 compliant" },
      { currencyType: CurrencyType.BOOSTABLE_ERC20, contractAddress: vanillaERC20Token.address, revertReason: "Dubiex: not BoostableERC20 compliant" },
      { currencyType: CurrencyType.BOOSTABLE_ERC20, contractAddress: constants.ZERO_ADDRESS, revertReason: "Dubiex: not BoostableERC20 compliant" },
      { currencyType: CurrencyType.BOOSTABLE_ERC20, contractAddress: deployment.Heroes.address, revertReason: "Dubiex: not BoostableERC20 compliant" },
      { currencyType: CurrencyType.BOOSTABLE_ERC20, contractAddress: deployment.Pets.address, revertReason: "Dubiex: not BoostableERC20 compliant" },
      // Purpose and Dubi pass correctly
      { currencyType: CurrencyType.BOOSTABLE_ERC20, contractAddress: deployment.Purpose.address, revertReason: "ERC20-10" },
      { currencyType: CurrencyType.BOOSTABLE_ERC20, contractAddress: deployment.Dubi.address, revertReason: "ERC20-10" },

      /* ERC20 */
      { currencyType: CurrencyType.ERC20, contractAddress: deployment.Heroes.address, revertReason: "Dubiex: ERC20 implements ERC721" },
      { currencyType: CurrencyType.ERC20, contractAddress: deployment.Pets.address, revertReason: "Dubiex: ERC20 implements ERC721" },
      { currencyType: CurrencyType.ERC20, contractAddress: constants.ZERO_ADDRESS, revertReason: "Address: call to non-contract" },
      // BoostableERC20 also works, since they are compatible
      { currencyType: CurrencyType.ERC20, contractAddress: deployment.Dubi.address, revertReason: "ERC20-10" },
      { currencyType: CurrencyType.ERC20, contractAddress: deployment.Purpose.address, revertReason: "ERC20-10" },
      // A vanilla ERC20 passes correctly
      { currencyType: CurrencyType.ERC20, contractAddress: vanillaERC20Token.address, revertReason: "ERC20: transfer amount exceeds balance" },
    ]

    it("should fail if contracts and currencyTypes are incompatible", async () => {
      const order = makeOrder();

      for (const { contractAddress, currencyType, revertReason } of testVector()) {
        await expectApprove(contractAddress, currencyType, order.makerValue, { from: alice });
        await expectRevert(deployment.Dubiex.makeOrder({
          makerValue: order.makerValue.toString(),
          takerValue: order.takerValue.toString(),
          pair: {
            makerCurrencyType: currencyType,
            takerCurrencyType: currencyType,
            makerContractAddress: contractAddress, // makerContractAddress
            takerContractAddress: contractAddress, // takerContractAddress
          },
          orderId: 0,
          ancestorOrderId: 0,
          updatedRatioWei: 0,
        }, { from: alice }
        ), revertReason);
      }
    });

  });

  describe("Dubiex - Multi", () => {

    const makeOrders = async (from: string, fixedMakerValue?: BN) => {
      const makeOrdersInput: any[] = [];

      for (let i = 0; i < 5; i++) {
        const makeOrder = {
          makerValue: (fixedMakerValue || ether(`${i + 1}`)).toString(),
          takerValue: ether(`${i + 1}`).toString(),
          pair: {
            makerContractAddress: deployment.Dubi.address,
            takerContractAddress: deployment.Purpose.address,
            makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
            takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          },
          orderId: 0,
          ancestorOrderId: 0,
          updatedRatioWei: 0,
        };

        makeOrdersInput.push(makeOrder);
      }

      await deployment.Dubiex.makeOrders(makeOrdersInput,
        { from }
      );
    }

    it("should make orders", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await makeOrders(alice);

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("85"));

      for (let i = 0; i < 5; i++) {
        const order = await getOrder(alice, i + 1);
        expectBigNumber(order.id, new BN(i + 1));
      }
    });

    it("should make orders and refund excess eth", async () => {
      const makeOrdersInput: any[] = [];
      for (let i = 0; i < 5; i++) {
        const makeOrder = {
          makerValue: ether("1").toString(),
          takerValue: ether(`${i + 1}`).toString(),
          pair: {
            makerContractAddress: constants.ZERO_ADDRESS,
            takerContractAddress: deployment.Purpose.address,
            makerCurrencyType: CurrencyType.ETH,
            takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          },
          orderId: 0,
          ancestorOrderId: 0,
          updatedRatioWei: 0,
        };

        makeOrdersInput.push(makeOrder);
      }

      const aliceEthBefore = new BN(await deployment.web3.eth.getBalance(alice));

      const receipt = await deployment.Dubiex.makeOrders(makeOrdersInput, { from: alice, value: ether("100") });

      const aliceEthAfter = new BN(await deployment.web3.eth.getBalance(alice));

      const gasPaidInWei = new BN(20e9).mul(new BN(receipt.receipt.gasUsed));

      // Only sent 5 ETH plus gas instead of 100 ETH
      expectBigNumber(aliceEthAfter, aliceEthBefore.sub(ether("5")).sub(gasPaidInWei))
    });

    it("should make orders and revert if any fails", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      const makeOrdersInput: any[] = [];
      let approvalAmount = new BN(0);

      for (let i = 0; i < 5; i++) {
        // Add bad order in the middle
        if (i === 2) {
          const makeOrder = {
            pair: {
              makerContractAddress: constants.ZERO_ADDRESS,
              takerContractAddress: deployment.Purpose.address,
              makerCurrencyType: CurrencyType.ETH,
              takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
            },
            makerValue: ether("9999").toString(),
            takerValue: ether("9999").toString(),
            orderId: 0,
            ancestorOrderId: 0,
            updatedRatioWei: 0,
          };

          approvalAmount = approvalAmount.add(new BN(makeOrder.makerValue));
          makeOrdersInput.push(makeOrder);
        }

        const makeOrder = {
          pair: {
            makerContractAddress: constants.ZERO_ADDRESS,
            takerContractAddress: deployment.Purpose.address,
            makerCurrencyType: CurrencyType.ETH,
            takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          },
          makerValue: ether("1").toString(),
          takerValue: ether("1").toString(),
          orderId: 0,
          ancestorOrderId: 0,
          updatedRatioWei: 0,
        };

        approvalAmount = approvalAmount.add(new BN(makeOrder.makerValue));
        makeOrdersInput.push(makeOrder);
      }

      await expectRevert(deployment.Dubiex.makeOrders(makeOrdersInput,
        { from: alice, value: ether("5000") /* enough eth to create all orders but the one for 9999 ETH */ }
      ), "Dubiex: failed to deposit. not enough funds?");
    });

    it("should take orders", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Purpose.mint(bob, ether("100"));

      await makeOrders(alice);

      // Fills all orders
      await expectApprove(deployment.Purpose.address, CurrencyType.BOOSTABLE_ERC20, ether("100"), { from: bob });

      await deployment.Dubiex.takeOrders([
        {
          id: "3", maker: alice, takerValue: ether("3").toString(), maxTakerMakerRatio: ether("1").toString(),
        },
        {
          id: "5", maker: alice, takerValue: ether("5").toString(), maxTakerMakerRatio: ether("1").toString(),
        },
        {
          id: "2", maker: alice, takerValue: ether("2").toString(), maxTakerMakerRatio: ether("1").toString(),
        },
        {
          id: "1", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(),
        },
        {
          id: "4", maker: alice, takerValue: ether("4").toString(), maxTakerMakerRatio: ether("1").toString(),
        },
      ],
        { from: bob }
      );

      for (let i = 0; i < 5; i++) {
        await expectDeletedOrder(alice, new BN(i + 1));
      }
    });

    it("should take orders and refund excess eth", async () => {
      await deployment.Purpose.mint(alice, ether("5"));

      const makeOrdersInput: any[] = [];

      for (let i = 0; i < 5; i++) {
        const makeOrder = {
          pair: {
            makerContractAddress: deployment.Purpose.address,
            takerContractAddress: constants.ZERO_ADDRESS,
            makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
            takerCurrencyType: CurrencyType.ETH,
          },
          makerValue: ether("1").toString(),
          takerValue: ether("1").toString(),
          orderId: 0,
          ancestorOrderId: 0,
          updatedRatioWei: 0,
        };

        makeOrdersInput.push(makeOrder);
      }

      let aliceEthBefore = new BN(await deployment.web3.eth.getBalance(alice));

      let receipt = await deployment.Dubiex.makeOrders(makeOrdersInput,
        { from: alice, value: ether("5") /* mistakenly send some ETH as well */ }
      );

      for (let i = 0; i < 5; i++) {
        expectBigNumber((await getOrder(alice, new BN(i + 1))).id, new BN(i + 1));
      }

      let gasPaidInWei = new BN(20e9).mul(new BN(receipt.receipt.gasUsed));
      let aliceEthAfter = new BN(await deployment.web3.eth.getBalance(alice));

      // Only paid gas and still has the 5 ETH back that was sent to make the order
      expectBigNumber(aliceEthAfter, aliceEthBefore.sub(gasPaidInWei));

      // Now take orders with Bob
      const bobEthBefore = new BN(await deployment.web3.eth.getBalance(bob));

      aliceEthBefore = new BN(await deployment.web3.eth.getBalance(alice));

      // Take all orders
      receipt = await deployment.Dubiex.takeOrders([
        { id: "1", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "2", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "3", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "4", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "5", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(), },
      ],
        { from: bob, value: ether("5000") /* sends way too much */ }
      );

      for (let i = 0; i < 5; i++) {
        await expectDeletedOrder(alice, new BN(i + 1));
      }

      const bobEthAfter = new BN(await deployment.web3.eth.getBalance(bob));
      aliceEthAfter = new BN(await deployment.web3.eth.getBalance(alice));

      // Alice got 5 ETH in total
      expectBigNumber(aliceEthAfter, aliceEthBefore.add(ether("5")));

      // Bob bought 5 PRPS
      expectBigNumber(await deployment.Purpose.balanceOf(bob), ether("5"));

      // Bob paid 5 ETH + gas in total
      gasPaidInWei = new BN(20e9).mul(new BN(receipt.receipt.gasUsed));
      expectBigNumber(bobEthAfter, bobEthBefore.sub(ether("5")).sub(gasPaidInWei));
    });

    it("should take orders partially", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Purpose.mint(bob, ether("100"));

      await makeOrders(alice);

      // Fill the 5th order 5 times, 1 DUBI per take order
      await expectApprove(deployment.Purpose.address, CurrencyType.BOOSTABLE_ERC20, ether("100"), { from: bob });

      await deployment.Dubiex.takeOrders([
        { id: "5", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "5", maker: alice, takerValue: ether("2").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "5", maker: alice, takerValue: ether("3").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "5", maker: alice, takerValue: ether("4").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "5", maker: alice, takerValue: ether("5").toString(), maxTakerMakerRatio: ether("1").toString(), },
      ],
        { from: bob }
      );

      // The order got filled completely after 5 takes
      await expectDeletedOrder(alice, new BN(5));
    });

    it("should take orders and ignore failed ones without reverting", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Purpose.mint(bob, ether("10"));

      await makeOrders(alice);

      // Bob only sends enough PRPS to fill order 1-4, causing order 5 to fail (PRPS=0)
      expectApprove(deployment.Purpose.address, CurrencyType.BOOSTABLE_ERC20, ether("100"), { from: bob });
      await deployment.Dubiex.takeOrders([
        { id: "1", maker: alice, takerValue: ether("1").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "2", maker: alice, takerValue: ether("2").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "5", maker: alice, takerValue: ether("0").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "99", maker: alice, takerValue: ether("5").toString(), maxTakerMakerRatio: ether("1").toString(), }, // non-existent
        { id: "100", maker: alice, takerValue: ether("5").toString(), maxTakerMakerRatio: ether("1").toString(), }, // non-existent
        { id: "99", maker: alice, takerValue: ether("5").toString(), maxTakerMakerRatio: ether("1").toString(), }, // non-existent
        { id: "3", maker: alice, takerValue: ether("3").toString(), maxTakerMakerRatio: ether("1").toString(), },
        { id: "4", maker: alice, takerValue: ether("4").toString(), maxTakerMakerRatio: ether("1").toString(), },
      ],
        { from: bob }
      );

      // Order 1 - 4 got filled (i.e. deleted)
      for (let i = 0; i < 4; i++) {
        await expectDeletedOrder(alice, new BN(i + 1));
      }

      // Last one is untouched
      const order = await getOrder(alice, 5);
      expectBigNumber(order.id, new BN("5"));
      expectBigNumber(order.makerValue, ether("5"));
      expectBigNumber(order.takerValue, ether("5"));
    });

    it("should update orders", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      // Puts 5 orders, 10 DUBI each so alice has 50 DUBI left.
      const makeOrderInputs: any[] = [];
      let approvalAmount = new BN(0);

      for (let i = 0; i < 5; i++) {
        const makeOrder = {
          makerValue: ether(`${i + 1}`).toString(),
          takerValue: ether(`${i + 1}`).toString(),
          pair: {
            makerContractAddress: deployment.Dubi.address,
            takerContractAddress: deployment.Purpose.address,
            makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
            takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          },
          orderId: 0,
          ancestorOrderId: i > 0 ? i : 0,
          updatedRatioWei: 0,
        };

        approvalAmount = approvalAmount.add(new BN(makeOrder.makerValue));
        makeOrderInputs.push(makeOrder);
      }

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("100"));
      expectBigNumber(await deployment.Dubi.balanceOf(deployment.Dubiex.address), ZERO);

      await deployment.Dubiex.makeOrders(
        makeOrderInputs,
        { from: alice }
      );

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("85"));
      expectBigNumber(await deployment.Dubi.balanceOf(deployment.Dubiex.address), ether("15"));

      // Half DUBI / PRPS ratio
      for (let i = 0; i < 5; i++) {
        const order = await getOrder(alice, new BN(i + 1));
        expectBigNumber(order.makerValue, makeOrderInputs[i].makerValue); // makerValue
        expectBigNumber(order.takerValue, makeOrderInputs[i].takerValue); // takerValue
        makeOrderInputs[i].updatedRatioWei = ether("2").toString();
      }

      await deployment.Dubiex.makeOrders(makeOrderInputs.map((input, i) => ({
        ...input,
        orderId: i + 1,
      })), { from: alice });

      // Check that orders were updated
      for (let i = 0; i < 5; i++) {
        const order = await getOrder(alice, new BN(i + 1));
        expectBigNumber(order.makerValue, makeOrderInputs[i].makerValue); // makerValue is unchanged
        expectBigNumber(order.takerValue, new BN(makeOrderInputs[i].takerValue).mul(new BN("2"))); // takerValue halved
      }

      // Balances unchanged since only takerValue was updated
      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("85"));
      expectBigNumber(await deployment.Dubi.balanceOf(deployment.Dubiex.address), ether("15"));

    });

    it("should update orders without reverting", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Purpose.mint(bob, ether("100"));

      // Puts 5 orders, 10 DUBI each so alice has 50 DUBI left.
      const makeOrderInputs: any[] = [];
      let approvalAmount = new BN(0);

      for (let i = 0; i < 5; i++) {
        const makeOrder = {
          makerValue: ether(`${i + 1}`).toString(),
          takerValue: ether(`${i + 1}`).toString(),
          pair: {
            makerContractAddress: deployment.Dubi.address,
            takerContractAddress: deployment.Purpose.address,
            makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
            takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          },
          orderId: 0,
          ancestorOrderId: 0,
          updatedRatioWei: 0,
        };

        approvalAmount = approvalAmount.add(new BN(makeOrder.makerValue));
        makeOrderInputs.push(makeOrder);
      }

      await expectApprove(deployment.Dubi.address, CurrencyType.BOOSTABLE_ERC20, approvalAmount.toString(), { from: alice });

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("100"));
      expectBigNumber(await deployment.Dubi.balanceOf(deployment.Dubiex.address), ZERO);

      await deployment.Dubiex.makeOrders(
        makeOrderInputs,
        { from: alice }
      );

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("85"));
      expectBigNumber(await deployment.Dubi.balanceOf(deployment.Dubiex.address), ether("15"));

      // Fill the third order completely so it no longer exists
      await expectTakeOrder({ maker: alice, takerValue: ether("3"), id: "3", txDetails: { from: bob } });
      expectBigNumber(await deployment.Dubi.balanceOf(deployment.Dubiex.address), ether("12"));

      // Half DUBI / PRPS ratio
      for (let i = 0; i < 5; i++) {
        const order = await getOrder(alice, new BN(i + 1));

        makeOrderInputs[i].orderId = i + 1;
        makeOrderInputs[i].updatedRatioWei = ether("2").toString();

        // Third order was filled and is thus zero
        if (i === 2) {
          expectBigNumber(order.id, ZERO);
        } else {
          expectBigNumber(order.makerValue, makeOrderInputs[i].makerValue); // makerValue
          expectBigNumber(order.takerValue, makeOrderInputs[i].takerValue); // takerValue
        }
      }

      await deployment.Dubiex.makeOrders(makeOrderInputs, { from: alice });

      // Check that orders were updated
      for (let i = 0; i < 5; i++) {
        const order = await getOrder(alice, new BN(i + 1));
        // Third order was filled and is thus zero
        if (i == 2) {
          expectBigNumber(order.id, ZERO);
          expectBigNumber(order.makerValue, ZERO);
          expectBigNumber(order.takerValue, ZERO);
        } else {
          expectBigNumber(order.makerValue, makeOrderInputs[i].makerValue); // makerValue is unchanged
          expectBigNumber(order.takerValue, new BN(makeOrderInputs[i].takerValue).mul(new BN("2"))); // takerValue halved
        }
      }

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("85"));
      expectBigNumber(await deployment.Dubi.balanceOf(deployment.Dubiex.address), ether("12"));
    });

    it("should cancel orders", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      await makeOrders(alice);

      // Cancel all 5 orders
      await deployment.Dubiex.cancelOrders([
        { maker: alice, id: "1" },
        { maker: alice, id: "2" },
        { maker: alice, id: "3" },
        { maker: alice, id: "4" },
        { maker: alice, id: "5" },
      ], { from: alice });

      // All orders are gone
      for (let i = 0; i < 5; i++) {
        await expectDeletedOrder(alice, new BN(i + 1));
      }
    });

    it("should revert on empty input", async () => {
      await expectRevert(deployment.Dubiex.cancelOrders([], { from: alice }), "Dubiex: empty input");
    });

    it("should cancel orders and ignore failed ones without reverting", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      await makeOrders(alice);

      // Cancel orders 1-3 and some random orders in-between that don't exist or got already cancelled.
      await deployment.Dubiex.cancelOrders([
        { maker: alice, id: "1" },
        { maker: alice, id: "100" },
        { maker: alice, id: "102" },
        { maker: alice, id: "2" },
        { maker: alice, id: "3" },
        { maker: alice, id: "1" },
      ], { from: alice });

      // All orders are gone
      for (let i = 0; i < 3; i++) {
        await expectDeletedOrder(alice, new BN(i + 1));
      }
    });

  });

  describe("Kill Switch", () => {
    const oneBillion = ether("1000000000");

    const updateTotalSupply = async (contract, amount) => {
      const upperHalf = amount;
      const lowerHalf = ZERO;
      const packed = upperHalf.shln(96).or(lowerHalf);

      await contract.mint(bob, packed);
      expectBigNumber(await contract.totalSupply(), amount);
    };

    it("should activate kill switch if PRPS supply is 1 Billion", async () => {
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");

      await updateTotalSupply(deployment.Purpose, oneBillion);

      await deployment.Dubiex.activateKillSwitch();
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");

      await updateTotalSupply(deployment.Purpose, ether("1"));

      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");
    });

    it("should activate kill switch if PRPS supply is over 1 Billion", async () => {
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");

      await updateTotalSupply(deployment.Purpose, oneBillion.add(new BN(1)));
      await deployment.Dubiex.activateKillSwitch();

      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");

      await updateTotalSupply(deployment.Purpose, ether("1"));
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");
    });

    it("should activate kill switch if DUBI supply is 1 Billion", async () => {
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");

      await updateTotalSupply(deployment.Dubi, oneBillion);
      await deployment.Dubiex.activateKillSwitch();

      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");

      await updateTotalSupply(deployment.Dubi, ether("1"));
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");
    });

    it("should activate kill switch if DUBI supply is over 1 Billion", async () => {
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");

      await updateTotalSupply(deployment.Dubi, oneBillion.add(new BN(1)));
      await deployment.Dubiex.activateKillSwitch();

      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");

      await updateTotalSupply(deployment.Dubi, ether("1"));
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");
    });

    it("should activate kill switch if PRPS and DUBI supply is over 1 Billion", async () => {
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");

      await updateTotalSupply(deployment.Dubi, oneBillion.add(new BN(1)));
      await updateTotalSupply(deployment.Purpose, oneBillion.add(new BN(1)));

      await deployment.Dubiex.activateKillSwitch();

      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: kill switch already on");
    });

    it("should not activate kill switch if neither PRPS nor DUBI is over or at 1 Billion", async () => {
      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");

      await updateTotalSupply(deployment.Dubi, new BN(1));
      await updateTotalSupply(deployment.Purpose, new BN(1));

      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");

      await updateTotalSupply(deployment.Dubi, oneBillion.sub(new BN(1)));
      await updateTotalSupply(deployment.Purpose, oneBillion.sub(new BN(1)));

      await expectRevert(deployment.Dubiex.activateKillSwitch(), "Dubiex: insufficient total supply for kill switch");
    });

    it("should not make order if kill-switch is on", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      const pair = {
        makerContractAddress: deployment.Dubi.address,
        takerContractAddress: deployment.Purpose.address,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
      }

      // Ok
      await expectMakeOrder({
        id: new BN(1),
        maker: alice,
        makerValue: ether("10"),
        takerValue: ether("10"),
        ...pair,
      }, { from: alice });

      await updateTotalSupply(deployment.Purpose, oneBillion);
      await deployment.Dubiex.activateKillSwitch();

      // Not ok
      await expectRevert(expectMakeOrder({
        id: new BN(1),
        maker: alice,
        makerValue: ether("10"),
        takerValue: ether("10"),
        ...pair,
      }, { from: alice }), "Dubiex: make order prevented by kill switch");


      await expectRevert(deployment.Dubiex.makeOrders([{
        makerValue: ether("10").toString(),
        takerValue: ether("10").toString(),
        pair,
        updatedRatioWei: 0,
        orderId: 0,
        ancestorOrderId: 0,
      }],
        { from: alice }
      ), "Dubiex: make order prevented by kill switch");

      // Boosted make order is also not ok
      const [boostedAlice] = deployment.boostedAddresses;

      const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: ether("10"),
        takerValue: ether("10"),
        makerContractAddress: pair.makerContractAddress,
        takerContractAddress: pair.takerContractAddress,
        makerCurrencyType: pair.makerCurrencyType,
        takerCurrencyType: pair.takerCurrencyType,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectRevert(deployment.Dubiex.boostedMakeOrder(message, signature, { from: deployment.booster }), "Dubiex: make order prevented by kill switch");
      await expectRevert(deployment.Dubiex.boostedMakeOrderBatch([message], [signature], { from: deployment.booster }), "Dubiex: make order prevented by kill switch");
    });

    it("should not take order if kill-switch is on", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Dubi.mint(bob, ether("100"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await expectMakeOrder(makeOrder, { from: alice });

      // Ok
      await expectTakeOrder({ maker: makeOrder.maker, id: makeOrder.id, takerValue: ether("1"), txDetails: { from: bob } });

      await updateTotalSupply(deployment.Purpose, oneBillion);
      await deployment.Dubiex.activateKillSwitch();

      // Not ok
      await expectRevert(expectTakeOrder({ maker: makeOrder.maker, id: makeOrder.id, takerValue: ether("1"), txDetails: { from: bob } }), "Dubiex: take order prevented by kill switch");

      await expectRevert(deployment.Dubiex.takeOrders([{ id: "1", maker: makeOrder.maker, takerValue: "1", maxTakerMakerRatio: "1" }], { from: bob }), "Dubiex: take order prevented by kill switch");

      // Boosted take order is also not ok
      const [boostedAlice] = deployment.boostedAddresses;

      const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
        id: makeOrder.id,
        taker: boostedAlice.address,
        takerValue: ether("1"),
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectRevert(deployment.Dubiex.boostedTakeOrder(message, signature, { from: deployment.booster }), "Dubiex: take order prevented by kill switch");
      await expectRevert(deployment.Dubiex.boostedTakeOrderBatch([message], [signature], { from: deployment.booster }), "Dubiex: take order prevented by kill switch");
    });

    it("should cancel any order if kill-switch is on", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await expectMakeOrder(makeOrder, { from: alice });

      // Not ok for bob to cancel alice's order
      await expectRevert(deployment.Dubiex.cancelOrder({ maker: alice, id: 1 }, { from: bob }), "Dubiex: msg.sender must be maker");

      await updateTotalSupply(deployment.Purpose, oneBillion);
      await deployment.Dubiex.activateKillSwitch();

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("90"));
      expectBigNumber(await deployment.Dubi.balanceOf(bob), ZERO);

      // Ok
      await deployment.Dubiex.cancelOrder({ maker: alice, id: 1 }, { from: bob });

      await expectDeletedOrder(alice, 1);

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("100"));
      expectBigNumber(await deployment.Dubi.balanceOf(bob), ZERO);
    });

    it("should cancel many orders if kill-switch is on", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Purpose.mint(bob, ether("100"));

      for (let i = 0; i < 5; i++) {
        const makeOrder = {
          id: new BN(i + 1),
          maker: alice,
          makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          makerContractAddress: deployment.Dubi.address,
          makerValue: ether("10"),
          takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          takerContractAddress: deployment.Dubi.address,
          takerValue: ether("10"),
        };
        await expectMakeOrder(makeOrder, { from: alice });
      }

      for (let i = 0; i < 5; i++) {
        const makeOrder = {
          id: new BN(i + 1),
          maker: bob,
          makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          makerContractAddress: deployment.Purpose.address,
          makerValue: ether("10"),
          takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          takerContractAddress: deployment.Purpose.address,
          takerValue: ether("10"),
        };

        await expectMakeOrder(makeOrder, { from: bob });
      }

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("50"));
      expectBigNumber(await deployment.Dubi.balanceOf(bob), ZERO);
      expectBigNumber(await deployment.Purpose.balanceOf(alice), ZERO);
      expectBigNumber(await deployment.Purpose.balanceOf(bob), ether("50"));

      // Not ok for bob to cancel his and alice's orders
      await expectRevert(deployment.Dubiex.cancelOrders([
        { maker: alice, id: 1 },
        { maker: bob, id: 1 },
        { maker: alice, id: 2 },
        { maker: bob, id: 2 },
        { maker: alice, id: 3 },
        { maker: bob, id: 3 },
        { maker: alice, id: 4 },
        { maker: bob, id: 4 },
        { maker: alice, id: 5 },
        { maker: bob, id: 5 },
      ],
        { from: bob },
      ), "Dubiex: msg.sender must be maker");

      await updateTotalSupply(deployment.Purpose, oneBillion);
      await deployment.Dubiex.activateKillSwitch();

      // Ok
      await deployment.Dubiex.cancelOrders([
        { maker: alice, id: 1 },
        { maker: bob, id: 1 },
        { maker: alice, id: 2 },
        { maker: bob, id: 2 },
        { maker: alice, id: 3 },
        { maker: bob, id: 3 },
        { maker: alice, id: 4 },
        { maker: bob, id: 4 },
        { maker: alice, id: 5 },
        { maker: bob, id: 5 },
      ],
        { from: bob },
      );

      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("100"));
      expectBigNumber(await deployment.Dubi.balanceOf(bob), ZERO);
      expectBigNumber(await deployment.Purpose.balanceOf(alice), ZERO);
      expectBigNumber(await deployment.Purpose.balanceOf(bob), ether("100"));
    });

    it("should not boost cancel order(s) from a non-maker even if kill-switch is on", async () => {
      await deployment.Dubi.mint(alice, ether("20"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await expectMakeOrder(makeOrder, { from: alice });
      await expectMakeOrder({ ...makeOrder, id: new BN(2), }, { from: alice });

      const [boostedAlice] = deployment.boostedAddresses;

      let { message, signature } = await createSignedBoostedCancelOrderMessage(deployment.web3, {
        id: makeOrder.id,
        maker: alice,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        signer: boostedAlice,
      });

      // The error comes from the invalid signature, since it will use `order.maker`
      await expectRevert(deployment.Dubiex.boostedCancelOrder(message, signature, { from: deployment.booster }), "AB-5");
      await expectRevert(deployment.Dubiex.boostedCancelOrderBatch([message], [signature], { from: deployment.booster }), "AB-5");

      await updateTotalSupply(deployment.Purpose, oneBillion);
      await deployment.Dubiex.activateKillSwitch();

      // Since it doesn't make sense to use a booster if anyone can cancel it anyway, it's not supported and still fails
      await expectRevert(deployment.Dubiex.boostedCancelOrder(message, signature, { from: deployment.booster }), "AB-5");
      await expectRevert(deployment.Dubiex.boostedCancelOrderBatch([message], [signature], { from: deployment.booster }), "AB-5");
    });
  })

  describe("Misc", () => {

    it("should fail to create order if makerValue invalid", async () => {
      await deployment.Dubi.mint(alice, ether("1"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: new BN(0),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await expectRevert(expectMakeOrder(makeOrder, { from: alice }), "Dubiex: makerValue must be greater 0");
    });

    it("should fail to create order if takerValue invalid", async () => {
      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: new BN(0),
      };

      await expectRevert(expectMakeOrder(makeOrder, { from: alice }), "Dubiex: takerValue must be greater 0");
    });

    it("should take order with a very high value", async () => {
      const billion = ether("1000000000");
      await deployment.Dubi.mint(alice, billion);
      await deployment.Purpose.mint(bob, billion.div(new BN(2)));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: billion,
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Purpose.address,
        takerValue: billion,
      };

      await expectMakeOrder(makeOrder, { from: alice });

      // Bob can take little
      await expectTakeOrder({ maker: alice, id: 1, takerValue: ether("1"), txDetails: { from: bob } });

      // Bob or all his PRPS
      await expectTakeOrder({ maker: alice, id: 1, takerValue: await deployment.Purpose.balanceOf(bob), txDetails: { from: bob } });

      // Mint more so bob can fill the other half
      await deployment.Purpose.mint(bob, billion.div(new BN(2)));

      // Bob or all his PRPS
      await expectTakeOrder({ maker: alice, id: 1, takerValue: await deployment.Purpose.balanceOf(bob), txDetails: { from: bob } });
      await expectDeletedOrder(alice, 1);
    });

    it("should assign next id to order on a per-account basis", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Dubi.mint(bob, ether("100"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      // First order of alice gets id 1
      await expectMakeOrder(makeOrder, { from: alice });
      let order = await getOrder(alice, 1);
      expectBigNumber(order.id, new BN(1));

      // Next order gets id 2
      await expectMakeOrder({ ...makeOrder, id: new BN(2) }, { from: alice });
      order = await getOrder(alice, 2);
      expectBigNumber(order.id, new BN(2));

      // Bob has it's own id counter
      await expectMakeOrder({ ...makeOrder, maker: bob }, { from: bob });
      order = await getOrder(bob, 1);
      expectBigNumber(order.id, new BN(1));

      // Now also at id 2
      await expectMakeOrder({ ...makeOrder, id: new BN(2), maker: bob }, { from: bob });
      order = await getOrder(bob, 2);
      expectBigNumber(order.id, new BN(2));
    });

    it("should not fail to take order", async () => {
      await deployment.Dubi.mint(bob, ether("10000000"));

      const makerTakerValues = [{
        makerValue: new BN("500000000000000000"),
        takerValue: new BN("6350000000000000"),
        fillValue: ether("365").div(new BN(100)),
      }, {
        makerValue: new BN("500"),
        takerValue: new BN("6350000"),
        fillValue: ether("365").div(new BN(100)),
      }, {
        makerValue: new BN("1"),
        takerValue: ether("55000"),
        fillValue: ether("55000"),
      }, {
        makerValue: ether("55000"),
        takerValue: new BN("1"),
        fillValue: new BN("1"),
      }, {
        makerValue: new BN("1"),
        takerValue: new BN("1"),
        fillValue: new BN("1"),
      }, {
        makerValue: new BN("1"),
        takerValue: new BN("1"),
        fillValue: new BN("2"),
      }, {
        makerValue: new BN("2"),
        takerValue: new BN("1"),
        fillValue: new BN("1"),
      }]

      for (let i = 0; i < makerTakerValues.length; i++) {
        const { makerValue, takerValue, fillValue, } = makerTakerValues[i];
        console.log(i + " - " + makerValue.toString() + " - " + takerValue.toString() + " - " + fillValue.toString());

        const makeOrder = {
          id: new BN(i + 1),
          maker: bob,
          makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          makerContractAddress: deployment.Dubi.address,
          makerValue,
          takerValue,
          takerCurrencyType: CurrencyType.ETH,
          takerContractAddress: constants.ZERO_ADDRESS,
        };

        await expectMakeOrder(makeOrder, { from: bob });

        await expectTakeOrder({ maker: bob, id: i + 1, takerValue: fillValue, txDetails: { from: alice, value: fillValue } })
      }
    });

    it("should fail to take order if id is invalid", async () => {
      await expectRevert(deployment.Dubiex.takeOrder({
        id: new BN(0).toString(),
        maker: alice,
        takerValue: ether("10").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        { from: alice },
      ), "Dubiex: order does not exist");

      await expectRevert(deployment.Dubiex.takeOrder({
        id: new BN(5).toString(),
        maker: alice,
        takerValue: ether("10").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        { from: alice },
      ), "Dubiex: order does not exist");
    });

    it("should fail take order if takerValue is invalid", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await expectMakeOrder(makeOrder, { from: alice });

      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder.id.toString(),
        maker: makeOrder.maker,
        takerValue: new BN(0).toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        { from: alice },
      ), "Dubiex: takerValue must be greater 0");
    });

    it("should fail take order if order has not the expected maxTakerMakerRatio", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Purpose.mint(bob, ether("100"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Purpose.address,
        takerValue: ether("50"),
      };

      await expectMakeOrder(makeOrder, { from: alice });

      // Order ratio is 5, but the taker expects 1

      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder.id.toString(),
        maker: makeOrder.maker,
        takerValue: ether("1").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        { from: bob },
      ), "Dubiex: invalid takerValue");

      // Maker updates order to ratio 1
      await expectUpdateOrder({ ...makeOrder, orderId: new BN(1), ratio: ether("1") }, ether("10"), { from: alice });

      // Now the take order works
      await deployment.Dubiex.takeOrder({
        id: makeOrder.id.toString(),
        maker: makeOrder.maker,
        takerValue: ether("1").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      }, { from: bob });

      // Maker updates order to ratio 0.2 so makerValue = 9, takerValue = 1.8
      await expectUpdateOrder({ ...makeOrder, orderId: new BN(1), ratio: ether("2").div(new BN(10)) }, ether("18").div(new BN(10)), { from: alice });

      // Still works if ratio is even more in bobs favor
      await deployment.Dubiex.takeOrder({
        id: makeOrder.id.toString(),
        maker: makeOrder.maker,
        takerValue: ether("1").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      }, { from: bob });

      // After partial fill:
      // MakerValue: 4
      // TakerValue: 0.8
      // Ratio: 0.2

      // Maker updates order to ratio 0.99
      // MakerValue: 4
      // TakerValue: 3.96
      await expectUpdateOrder({ ...makeOrder, orderId: new BN(1), ratio: ether("99").div(new BN(100)) }, ether("396").div(new BN(100)), { from: alice });

      // But Bob still wants 0.2
      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder.id.toString(),
        maker: makeOrder.maker,
        takerValue: ether("1").toString(),
        maxTakerMakerRatio: ether("2").div(new BN(10)).toString(),
      },
        { from: bob },
      ), "Dubiex: invalid takerValue");

      // Alice goes back to 1
      // MakerValue: 4
      // TakerValue: 4
      await expectUpdateOrder({ ...makeOrder, orderId: new BN(1), ratio: ether("1") }, ether("4"), { from: alice });

      // Bob changes his mind and takes it
      await deployment.Dubiex.takeOrder({
        id: makeOrder.id.toString(),
        maker: makeOrder.maker,
        takerValue: ether("4").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      }, { from: bob });

      await expectDeletedOrder(alice, 1);
    });

    it("should take order and refund remainder", async () => {
      await deployment.Dubi.mint(alice, ether("100"));
      await deployment.Purpose.mint(bob, ether("100"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Purpose.address,
        takerValue: ether("10"),
      };

      await expectMakeOrder(makeOrder, { from: alice });

      const balanceBefore = await deployment.Purpose.balanceOf(bob);

      // fills order with 50 instead of 10
      await expectTakeOrder({ maker: makeOrder.maker, id: makeOrder.id, takerValue: ether("50"), txDetails: { from: bob } });

      const balanceAfter = await deployment.Purpose.balanceOf(bob);

      // Difference between after and before is the actual takerValue
      expectBigNumber((balanceBefore as any).sub(balanceAfter), makeOrder.takerValue);
    });

    it("should take order and refund remainder (ETH)", async () => {
      await deployment.Dubi.mint(alice, ether("100"));

      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.ETH,
        takerContractAddress: constants.ZERO_ADDRESS,
        takerValue: ether("10"),
      };

      await expectMakeOrder(makeOrder, { from: alice });

      const balanceBefore = await deployment.web3.eth.getBalance(charlie);

      // fills order with 50 instead of 10, so gets 40 refunded (minus gas)
      await expectTakeOrder({ maker: makeOrder.maker, id: makeOrder.id, takerValue: ether("50"), txDetails: { from: charlie, value: ether("50") } });

      const balanceAfter = await deployment.web3.eth.getBalance(charlie);
      const spent = new BN(balanceBefore).sub(new BN(balanceAfter));

      // Account for ~0.017 gas paid
      expect(spent.sub(makeOrder.takerValue).lte(new BN("1800000000000000"))).to.be.true;
    });

    it("should not cancel order if not maker", async () => {
      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await deployment.Dubi.mint(alice, ether("100"));

      await expectMakeOrder(makeOrder, { from: alice });
      await expectRevert(expectCancelOrder(bob, makeOrder.id, { from: bob }), "Dubiex: order does not exist");
    });

    it("should fail cancel non-existing order", async () => {
      await expectRevert(expectCancelOrder(bob, new BN(5), { from: bob }), "Dubiex: order does not exist");
    });

    it("should fail cancelling an order twice", async () => {
      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await deployment.Dubi.mint(alice, ether("100"));

      await expectMakeOrder(makeOrder, { from: alice });
      await expectCancelOrder(makeOrder.maker, makeOrder.id, { from: alice });

      await expectRevert(expectCancelOrder(alice, makeOrder.id, { from: alice }), "Dubiex: order does not exist");
    });


    it("should fail taking an cancelled order (because it doesn't exist anymore)", async () => {
      const makeOrder = {
        id: new BN(1),
        maker: alice,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: deployment.Dubi.address,
        takerValue: ether("10"),
      };

      await deployment.Dubi.mint(alice, ether("100"));

      await expectMakeOrder(makeOrder, { from: alice });
      await expectCancelOrder(makeOrder.maker, makeOrder.id, { from: alice });

      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder.id.toString(),
        maker: makeOrder.maker,
        takerValue: ether("10").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        {
          from: bob,
        }
      ), "Dubiex: order does not exist");
    });
  });

  it("should get order pair by alias/hash", async () => {
    const nullPair = {
      makerCurrencyType: CurrencyType.NULL,
      takerCurrencyType: CurrencyType.NULL,
      makerContractAddress: constants.ZERO_ADDRESS,
      takerContractAddress: constants.ZERO_ADDRESS,
    }

    const orderPair1 = {
      makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
      makerContractAddress: deployment.Dubi.address,
      takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
      takerContractAddress: deployment.Dubi.address,
    }

    const orderPair2 = {
      makerCurrencyType: CurrencyType.ERC20,
      makerContractAddress: deployment.Dubi.address,
      takerCurrencyType: CurrencyType.ERC20,
      takerContractAddress: deployment.Dubi.address,
    }

    const makeOrder1 = {
      id: new BN(1),
      maker: alice,
      ...orderPair1,
      makerValue: ether("10"),
      takerValue: ether("10"),
    };

    // Pair with same address as previous but different currency
    const makeOrder2 = {
      id: new BN(2),
      maker: alice,
      ...orderPair2,
      makerValue: ether("10"),
      takerValue: ether("10"),
    };

    const expectOrderPair = async (alias, orderPair) => {
      const actualOrderPair = await deployment.Dubiex.getOrderPairByAlias(alias);
      expectOrderPairEqual(actualOrderPair, orderPair);
    }

    const expectOrderPairByHash = async (hash, orderPair) => {
      const actualOrderPair = await deployment.Dubiex.getOrderPairByHash(hash);
      expectOrderPairEqual(actualOrderPair, orderPair);
    }

    const expectOrderPairEqual = (pairA, pairB) => {
      expect(pairA.makerContractAddress).to.eq(pairB.makerContractAddress);
      expect(pairA.takerContractAddress).to.eq(pairB.takerContractAddress);
      expect(pairA.makerCurrencyType.toString()).to.eq(pairB.makerCurrencyType.toString());
      expect(pairA.takerCurrencyType.toString()).to.eq(pairB.takerCurrencyType.toString());
    }


    await deployment.Dubi.mint(alice, ether("100"));
    await expectMakeOrder(makeOrder1, { from: alice });
    await expectMakeOrder(makeOrder2, { from: alice });

    await expectOrderPair(2, {
      makerCurrencyType: CurrencyType.ERC20,
      makerContractAddress: deployment.Dubi.address,
      takerCurrencyType: CurrencyType.ERC20,
      takerContractAddress: deployment.Dubi.address,
    });

    await expectOrderPair(1, orderPair1);
    await expectOrderPair(2, orderPair2);

    // Non existent
    await expectOrderPair(3, nullPair);

    // Get pair by hash
    const orderPairHash = createOrderPairHash(
      orderPair1.makerContractAddress,
      orderPair1.takerContractAddress,
      orderPair1.makerCurrencyType,
      orderPair1.takerCurrencyType
    );

    const nonExistentOrderPairHash = createOrderPairHash(
      orderPair1.makerContractAddress,
      constants.ZERO_ADDRESS,
      orderPair1.makerCurrencyType,
      orderPair1.takerCurrencyType,
    );

    await expectOrderPairByHash(orderPairHash, orderPair1);

    // Non existent
    await expectOrderPairByHash(nonExistentOrderPairHash, nullPair);

    // Get alias by hash
    let orderPairAlias = await deployment.Dubiex.getOrderPairAliasByHash(orderPairHash);
    expect(orderPairAlias.toString()).to.eq("1");

    orderPairAlias = await deployment.Dubiex.getOrderPairAliasByHash(nonExistentOrderPairHash);
    expect(orderPairAlias.toString()).to.eq("0");
  });

});

describe("Dubiex - Successor/Ancestor/Update Orders", () => {
  const makeOrder = (): Order => ({
    id: new BN(1),
    maker: alice,
    makerCurrencyType: CurrencyType.ETH,
    makerContractAddress: constants.ZERO_ADDRESS,
    makerValue: ether("10"),
    takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
    takerContractAddress: deployment.Dubi.address,
    takerValue: ether("10"),
  });

  it("should make a order with ancestor and correctly hide successor", async () => {
    const order1 = makeOrder();
    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = new BN(1);

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Successor of order1 has been set to order 2 - which means that order 2 is hidden.
    const madeOrder1 = await getOrder(alice, 1);
    expectBigNumber(madeOrder1.id, order1.id);
    expectBigNumber(madeOrder1.ancestorOrderId, ZERO);
    expectBigNumber(madeOrder1.successorOrderId, order2.id);
    expect(madeOrder1.isHidden).to.be.false;

    const madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.id, order2.id);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;
  });

  it("should upsert order", async () => {
    const order = makeOrder();
    order.makerValue = ether("100");
    order.takerValue = ether("100");

    // First the order is created with makerValue = 100, takerValue = 100
    await expectUpdateOrder(order, ether("100"), { from: alice, value: ether("100") });

    const expectUpdatedRatio = async (ratio: BN, newTakerValue: BN) => {
      await expectUpdateOrder({ ...order, orderId: new BN(1), ratio, makerValue: order.makerValue }, newTakerValue, { from: alice });
    }

    // Ratio 0.5 => takerValue = 50
    await expectUpdatedRatio(ether("1").div(new BN("2")), ether("50"));

    // Ratio 2 => takerValue = 200
    await expectUpdatedRatio(ether("2"), ether("200"));

    // Buy half (makerValue = 50, takerValue = 100)
    await deployment.Dubi.mint(bob, ether("100"));
    await expectTakeOrder({ maker: alice, id: 1, takerValue: ether("100"), txDetails: { from: bob } });

    let partiallyFilledOrder = await getOrder(alice, 1);
    expectBigNumber(partiallyFilledOrder.makerValue, ether("50"));
    expectBigNumber(partiallyFilledOrder.takerValue, ether("100"));

    // Ratio 1 => takerValue = 50
    await expectUpdatedRatio(ether("1"), ether("50"));
    partiallyFilledOrder = await getOrder(alice, 1);
    expectBigNumber(partiallyFilledOrder.makerValue, ether("50"));
    expectBigNumber(partiallyFilledOrder.takerValue, ether("50"));
  });

  it("should upsert a stable order while maker/TakerValue ratio is not equal", async () => {
    const order = makeOrder();
    order.makerValue = ether("50");
    order.takerValue = ether("10");

    // First the order is created, ratio is 5 DUBI per ETH ("5")
    await expectUpdateOrder(order, ether("10"), { from: alice, value: ether("50") });

    // Set ratio to 1 DUBI per ETH
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1") }, ether("50"), { from: alice });

    // Set ratio to 1 DUBI per 0.5 ETH
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1").div(new BN("2")) }, ether("50").div(new BN("2")), { from: alice });

    // Set ratio to 1 DUBI per 0.01 ETH
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1").div(new BN("100")) }, ether("5").div(new BN("10")), { from: alice });

    // Set ratio to 1 DUBI per 50 ETH
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1").mul(new BN("10")) }, ether("50").mul(new BN("10")), { from: alice });

    // Another order
    const order2 = makeOrder();
    // 8169.95
    order2.id = new BN(2);
    order2.makerValue = ether("816995").div(new BN("100"));
    // 75.6066559322034
    order2.takerValue = ether("756066559322034").div(new BN("10").pow(new BN("13")));

    // Create order with ratio 0.009254237288135594
    await expectUpdateOrder(order2, order2.takerValue, { from: alice, value: order2.makerValue });

    // Set ratio to 0.008806451612903226, changing taker value from 75.6066559322034 to 71.94826935483871
    await expectUpdateOrder({ ...order2, orderId: new BN(2), ratio: new BN("8806451612903226") },
      ether("7194826935483871125870").div(new BN("10").pow(new BN("20"))),
      { from: alice }
    );

    // Set ratio back
    await expectUpdateOrder({ ...order2, orderId: new BN(2), ratio: new BN("9254237288135594") },
      ether("7560665593220339620030").div(new BN("10").pow(new BN("20"))),
      { from: alice }
    );

    // Set ratio to 1.10, changing taker value from 75.6066559322034 to 8986.945000000000000000
    await expectUpdateOrder({ ...order2, orderId: new BN(2), ratio: new BN("1100000000000000000") },
      ether("8986945000000000000000").div(new BN("10").pow(new BN("18"))),
      { from: alice }
    );

    // Set ratio back
    await expectUpdateOrder({ ...order2, orderId: new BN(2), ratio: new BN("9254237288135594") },
      ether("7560665593220339620030").div(new BN("10").pow(new BN("20"))),
      { from: alice }
    );
  });

  it("should upsert a stable order with very small values", async () => {
    const order = makeOrder();
    order.makerValue = new BN("50");
    order.takerValue = new BN("10");

    // First the order is created, ratio is 0.000000000000000005 DUBI per WEI
    await expectUpdateOrder(order, new BN("10"), { from: alice, value: new BN("50") });

    // Set ratio to 0.000000000000000001 DUBI per 1 WEI (takerValue = 50)
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1") }, new BN("50"), { from: alice });

    // Set ratio to 0.000000000000000001 DUBI per 2 WEI (takerValue = 100)
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("2") }, new BN("100"), { from: alice });

    // Set ratio to 0.000000000000000001 DUBI per 100000 WEI (takerValue = 5000000)
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("100000") }, new BN("5000000"), { from: alice });
  });

  it("should upsert a stable order with very large and small ratios", async () => {
    const order = makeOrder();
    order.makerValue = ether("50");
    order.takerValue = ether("10");

    // First the order is created, ratio is 5 DUBI per ETH 1/5 = 0.2
    await expectUpdateOrder(order, ether("10"), { from: alice, value: ether("50") });

    // Set same ratio as make order, takeOrder stays the same
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1").div(new BN("5")) }, ether("10"), { from: alice });

    //
    // DUBI gets more valuable

    // Set ratio to 50 DUBI for 10000 ETH = 10000/50 = 200
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("200") }, ether("10000"), { from: alice });

    // Should overflow if resulting taker value gets too big (> 2**96)
    await expectRevert(expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("2000000000") }, ether("100000000000"), { from: alice }), "Dubiex: takerValue overflow");

    // Increase ratio by factor of 10 each iteration until reaching (=10^6).
    // With each iteration the takerValue is increased by a factor of 10 compared to the previous one.
    for (let i = 0; i < 6; i++) {
      const c = new BN("10").pow(new BN(i + 1));
      await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1").mul(c) }, order.makerValue.mul(c), { from: alice });
    }

    //
    // DUBI gets less valuable

    // Set ratio to 5 DUBI per 0.5 ETH (takerValue = 5 ETH)
    await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1").div(new BN("10")) }, ether("5"), { from: alice });

    // Decrease ratio by factor of 10 each iteration until reaching the lowest point (=10^18).
    // With each iteration the takerValue is decreased by a factor of 10 compared to the previous one.
    for (let i = 0; i < 18; i++) {
      const c = new BN("10").pow(new BN(i + 1));
      await expectUpdateOrder({ ...order, orderId: new BN(1), ratio: ether("1").div(c) }, order.makerValue.div(c), { from: alice });
    }
  });

  it("should not upsert a stable order if buying ERC721", async () => {
    const order1 = makeOrder();
    order1.takerValue = new BN(12345);
    order1.takerContractAddress = deployment.Heroes.address;
    order1.takerCurrencyType = CurrencyType.ERC721;

    // Creating works fine
    await expectUpdateOrder({ ...order1, ratio: ether("2") }, new BN(12345), { from: alice, value: order1.makerValue });

    // Reverts, because changing the ratio for an ERC721 does not make sense
    await expectRevert(expectUpdateOrder({ ...order1, orderId: new BN(1), ratio: ether("2") }, new BN(12345), { from: alice, value: order1.makerValue }), "Dubiex: cannot update ERC721 value");

    // Same if ERC721 is on makerValue
    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.makerValue = new BN(12345);
    order2.makerContractAddress = deployment.Heroes.address;
    order2.makerCurrencyType = CurrencyType.ERC721;

    await expectCreateCollectible(12345, alice)
    await expectUpdateOrder({ ...order2, ratio: ether("2") }, ether("10") /* sold for 10 ETH */, { from: alice });

    // Reverts, because changing the ratio for an ERC721 does not make sense
    await expectRevert(expectUpdateOrder({ ...order2, orderId: new BN(2), ratio: ether("2") }, ether("10"), { from: alice }), "Dubiex: cannot update ERC721 value");
  });

  it("should not upsert an filled order", async () => {
    const order = makeOrder();
    order.ratio = ether("1");

    await deployment.Dubi.mint(bob, ether("10"));

    await expectUpdateOrder(order, ether("10"), { from: alice, value: ether("10") });
    await expectTakeOrder({ maker: alice, id: order.id, takerValue: ether("10"), txDetails: { from: bob } });

    // Trying to upsert now fails, because the stable order got filled and cannot be used anymore.
    await expectRevert(expectUpdateOrder({ ...order, orderId: order.id }, ether("10"), { from: alice, value: ether("10") }), "Dubiex: order does not exist");
  });

  it("should make successor order visible when filled", async () => {
    await deployment.Dubi.mint(bob, ether("100"));

    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = new BN(1);

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Order 2 is still hidden
    let madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;

    // Fill order 1 with bob
    await expectTakeOrder({ maker: alice, id: order1.id, takerValue: ether("10"), txDetails: { from: bob } });

    // Order 2 is no longer hidden
    madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.false;

    // Fill order 2 with bob
    await expectTakeOrder({ maker: alice, id: order2.id, takerValue: ether("10"), txDetails: { from: bob } });
  });

  it("should not make successor order visible when filled if it got cancelled", async () => {
    await deployment.Dubi.mint(bob, ether("100"));

    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = new BN(1);

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    const order3 = makeOrder();
    order3.id = new BN(3);
    order3.ancestorOrderId = new BN(2);

    await expectMakeOrder(order3, { from: alice, value: ether("10") });

    // Order 2 and 3 still hidden
    let madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, order3.id);
    expect(madeOrder2.isHidden).to.be.true;

    let madeOrder3 = await getOrder(alice, 3);
    expectBigNumber(madeOrder3.ancestorOrderId, order2.id);
    expectBigNumber(madeOrder3.successorOrderId, ZERO);
    expect(madeOrder3.isHidden).to.be.true;

    // Cancel order 2
    await expectCancelOrder(alice, 2, { from: alice });

    // Fill order 1 with bob
    await expectTakeOrder({ maker: alice, id: order1.id, takerValue: ether("10"), txDetails: { from: bob } });

    // Taking it again will fail
    const ratio = ether("1").toString();
    await expectRevert(deployment.Dubiex.takeOrder({ maker: alice, id: order1.id.toString(), takerValue: ether("10").toString(), maxTakerMakerRatio: ratio }, { from: alice }), "Dubiex: order does not exist");

    // Order 2 is not put visible since it doesn't exist anymore
    await expectDeletedOrder(alice, 2);

    // Order 3 still exists, but is a zombie now
    madeOrder3 = await getOrder(alice, 3);
    expectBigNumber(madeOrder3.ancestorOrderId, order2.id);
    expectBigNumber(madeOrder3.successorOrderId, ZERO);
    expect(madeOrder3.isHidden).to.be.true;

    // Taking either order 2 or 3 will fail
    await expectRevert(deployment.Dubiex.takeOrder({ maker: alice, id: order2.id.toString(), takerValue: ether("10").toString(), maxTakerMakerRatio: ratio }, { from: alice }), "Dubiex: order does not exist");
    await expectRevert(deployment.Dubiex.takeOrder({ maker: alice, id: order3.id.toString(), takerValue: ether("10").toString(), maxTakerMakerRatio: ratio }, { from: alice }), "Dubiex: order does not exist");

    // But order 3 can be cancelled
    await expectRevert(deployment.Dubiex.cancelOrder({ maker: alice, id: order2.id.toString() }, { from: alice }), "Dubiex: order does not exist");
    await expectCancelOrder(alice, 3, { from: alice });
  });

  it("should make successor order visible when filled (different trading pair)", async () => {
    await deployment.Dubi.mint(bob, ether("100"));
    await deployment.Purpose.mint(alice, ether("100"));

    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.makerContractAddress = deployment.Purpose.address;
    order2.makerCurrencyType = CurrencyType.BOOSTABLE_ERC20;
    order2.takerContractAddress = vanillaERC20Token.address;
    order2.takerCurrencyType = CurrencyType.ERC20;
    order2.takerValue = ether("10")
    order2.ancestorOrderId = order1.id;

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Order 2 is still hidden
    let madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;

    // Fill order 1 with bob
    await expectTakeOrder({ maker: alice, id: order1.id, takerValue: ether("10"), txDetails: { from: bob } });

    // Order 2 is no longer hidden
    madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.false;

    // Fill order 2 with bob
    await vanillaERC20Token.mint(bob, ether("10"));
    await expectTakeOrder({ maker: alice, id: order2.id, takerValue: ether("10"), txDetails: { from: bob } });
  });

  it("should not make successor order visible when ancestor only got partially filled", async () => {
    await deployment.Dubi.mint(bob, ether("100"));

    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = order1.id;

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Order 2 is still hidden
    let madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;

    // Partially fill order 1 with bob
    await expectTakeOrder({ maker: alice, id: order1.id, takerValue: ether("5"), txDetails: { from: bob } });

    // Order 2 is still hidden
    madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;


    // Trying to fill order 2 with bob reverts because it's still hidden
    await expectRevert(deployment.Dubiex.takeOrder({
      id: order2.id.toString(),
      maker: order2.maker,
      takerValue: ether("10").toString(),
      maxTakerMakerRatio: ether("1").toString(),
    },
      {
        from: bob,
      }
    ), "Dubiex: order does not exist");

    // Now fill order 1 completely with bob
    await expectTakeOrder({ maker: alice, id: order1.id, takerValue: ether("5"), txDetails: { from: bob } });

    // Order 2 is no longer hidden
    madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.false;

    // Now bob can also fill order 2
    await expectTakeOrder({ maker: alice, id: order2.id, takerValue: ether("10"), txDetails: { from: bob } });
  });

  it("should not make successor visible if it got cancelled", async () => {
    await deployment.Dubi.mint(bob, ether("100"));

    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = order1.id;

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Order 2 is hidden
    let madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;

    // Cancel order 2
    await expectCancelOrder(order2.maker, order2.id, { from: alice });

    // Fill order 1 with bob
    await expectTakeOrder({ maker: alice, id: order1.id, takerValue: ether("10"), txDetails: { from: bob } });

    // Filling non-existent order 2 with bob reverts
    await expectRevert(deployment.Dubiex.takeOrder({
      id: order2.id.toString(),
      maker: order2.maker,
      takerValue: ether("10").toString(),
      maxTakerMakerRatio: ether("1").toString(),
    },
      {
        from: bob,
      }
    ), "Dubiex: order does not exist");
  });

  it("should not make successor visible if ancestor got cancelled", async () => {
    await deployment.Dubi.mint(bob, ether("100"));

    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = order1.id;

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Order 2 is hidden
    let madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;

    // Cancel order 1 (ancestor)
    await expectCancelOrder(order1.maker, order1.id, { from: alice });

    // Order 2 still hidden
    madeOrder2 = await getOrder(alice, 2);
    expectBigNumber(madeOrder2.ancestorOrderId, order1.id);
    expectBigNumber(madeOrder2.successorOrderId, ZERO);
    expect(madeOrder2.isHidden).to.be.true;
  });

  it("should revert if trying to fill hidden order", async () => {
    await deployment.Dubi.mint(bob, ether("100"));

    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = order1.id;

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Trying to fill order 2 with bob reverts because it's still hidden
    await expectRevert(deployment.Dubiex.takeOrder({
      id: order2.id.toString(),
      maker: order2.maker,
      takerValue: ether("10").toString(),
      maxTakerMakerRatio: ether("1").toString(),
    },
      {
        from: bob,
      }
    ), "Dubiex: order does not exist");
  });

  it("should revert if trying to create a successor if ancestor already has a successor", async () => {
    await deployment.Dubi.mint(alice, ether("10"));
    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    const order2 = makeOrder();
    order2.id = new BN(2);
    order2.ancestorOrderId = order1.id;

    await expectMakeOrder(order2, { from: alice, value: ether("10") });

    // Reverts, because order2 is already the successor of order 1
    await expectRevert(deployment.Dubiex.makeOrder({
      makerValue: ether("10").toString(),
      takerValue: ether("10").toString(),
      pair: {
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerCurrencyType: CurrencyType.ETH,
        makerContractAddress: deployment.Dubi.address,
        takerContractAddress: constants.ZERO_ADDRESS,
      },
      orderId: "0",
      ancestorOrderId: "1",
      updatedRatioWei: "0",
    },
      //
      {
        from: alice,
      }
    ), "Dubiex: ancestor order already has a successor");
  });

  it("should revert if invalid ratio is given", async () => {
    await deployment.Dubi.mint(alice, ether("10"));
    const order1 = makeOrder();

    await expectMakeOrder(order1, { from: alice, value: ether("10") });

    await expectRevert(deployment.Dubiex.makeOrder({
      makerValue: ether("10").toString(),
      takerValue: ether("10").toString(),
      pair: {
        makerCurrencyType: order1.makerCurrencyType,
        takerCurrencyType: order1.takerCurrencyType,
        makerContractAddress: order1.makerContractAddress,
        takerContractAddress: order1.takerContractAddress,
      },
      orderId: order1.id.toString(),
      ancestorOrderId: "0",
      updatedRatioWei: "0",
    },
      {
        from: alice,
      }
    ), "Dubiex: ratio is 0");
  });

});

describe("Dubiex - OptIn", () => {
  const makeOrder = () => ({
    id: new BN(1),
    maker: alice,
    makerCurrencyType: CurrencyType.ETH,
    makerContractAddress: constants.ZERO_ADDRESS,
    makerValue: ether("10"),
    takerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
    takerContractAddress: deployment.Dubi.address,
    takerValue: ether("10"),
    orderId: ZERO,
    ancestorOrderId: ZERO,
  });

  beforeEach(async () => {
    await optIn.activateAndRenounceOwnership();
    await optIn.instantOptOut(deployment.Dubiex.address, { from: deployment.booster });
  })

  describe("Unboosted", () => {

    it("should make order for non-boostable token", async () => {

      // Selling 10 ETH for DUBI (boostable) directly is fine
      await expectMakeOrder(makeOrder(), { from: alice, value: ether("10") });
    });

    it("should not make order for boostable token", async () => {
      await deployment.Dubi.mint(alice, ether("10"));

      // Selling 10 DUBI directly without booster fails
      await expectRevert(deployment.Dubiex.makeOrder({
        makerValue: ether("10").toString(),
        takerValue: ether("10").toString(),
        pair: {
          makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          takerCurrencyType: CurrencyType.ETH,
          makerContractAddress: deployment.Dubi.address,
          takerContractAddress: constants.ZERO_ADDRESS,
        },
        orderId: "0",
        ancestorOrderId: "0",
        updatedRatioWei: "0",
      },
        {
          from: alice,
        }
      ), "ERC20-17");

      // Give Dubiex an allowance
      await deployment.Dubi.approve(deployment.Dubiex.address, ether("10"), { from: alice });

      // Still fails, because DUBI has special behavior and isn't transferred to Dubiex
      await expectRevert(deployment.Dubiex.makeOrder({
        makerValue: ether("10").toString(),
        takerValue: ether("10").toString(),
        pair: {
          makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
          takerCurrencyType: CurrencyType.ETH,
          makerContractAddress: deployment.Dubi.address,
          takerContractAddress: constants.ZERO_ADDRESS,
        },
        orderId: "0",
        ancestorOrderId: "0",
        updatedRatioWei: "0",
      },
        {
          from: alice,
        }
      ), "ERC20-17");
    });

    it("should not make order for boostable token when sold as ERC20", async () => {
      await deployment.Dubi.mint(alice, ether("10"));

      await deployment.Dubi.approve(deployment.Dubiex.address, ether("1000"), { from: alice });

      // Selling 10 DUBI as an ERC20 directly doesn't work either when opted-in and reverts
      await expectRevert(deployment.Dubiex.makeOrder({
        makerValue: ether("10").toString(),
        takerValue: ether("10").toString(),
        pair: {
          makerCurrencyType: CurrencyType.ERC20,
          takerCurrencyType: CurrencyType.ETH,
          makerContractAddress: deployment.Dubi.address,
          takerContractAddress: constants.ZERO_ADDRESS,
        },
        orderId: "0",
        ancestorOrderId: "0",
        updatedRatioWei: "0",
      },
        {
          from: alice,
        }
      ), "ERC20-7");
    });

    it("should take order for non-boostable token", async () => {
      await vanillaERC20Token.mint(bob, ether("10"), { from: defaultSender });

      // Sell 10 ETH for DummyToken (ERC20)
      await expectMakeOrder({
        ...makeOrder(),
        takerContractAddress: vanillaERC20Token.address,
        takerCurrencyType: CurrencyType.ERC20,
      }, { from: alice, value: ether("10") });

      // Buying while opted-in without going through booster is fine
      await expectTakeOrder({ maker: makeOrder().maker, id: makeOrder().id, takerValue: ether("10"), txDetails: { from: bob } });
    });

    it("should buy DUBI with ETH", async () => {
      // Sell 10 DUBI for 10 ETH
      await optIn.instantOptOut(alice, { from: deployment.booster });
      await deployment.Dubi.mint(alice, ether("10"));

      // Alice creates order (opted-out)

      const order = {
        ...makeOrder(),
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        makerContractAddress: deployment.Dubi.address,
        makerValue: ether("10"),
        takerCurrencyType: CurrencyType.ETH,
        takerContractAddress: constants.ZERO_ADDRESS,
      };

      await expectMakeOrder(order, { from: alice });

      // Bob fills the order while opted-in without booster, since he's using ETH that's fine.
      expect((await optIn.getOptInStatus(bob)).isOptedIn).to.be.true;
      await expectTakeOrder({ maker: order.maker, id: order.id, takerValue: ether("10"), txDetails: { from: bob, value: ether("10") } });
    });

    it("should not take order for boostable ERC20 token", async () => {
      await deployment.Dubi.mint(bob, ether("10"), { from: defaultSender });

      // Sell 10 ETH for DUBI
      await expectMakeOrder({
        ...makeOrder(),
      }, { from: alice, value: ether("10") });

      // Buying the ETH with DUBI fails while opted-in without going through booster
      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder().id.toString(),
        maker: makeOrder().maker,
        takerValue: ether("10").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        {
          from: bob,
        }
      ), "ERC20-17");

      // Give Dubiex an allowance from bob (taker)
      await deployment.Dubi.approve(deployment.Dubiex.address, ether("10"), { from: bob });

      // Still fails, because DUBI has special behavior and isn't transferred to Dubiex
      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder().id.toString(),
        maker: makeOrder().maker,
        takerValue: ether("10").toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        {
          from: bob,
        }
      ), " ERC20-17");
    });

    it("should not take order for boostable token (ERC721)", async () => {
      await deployment.Dubi.mint(bob, ether("10"), { from: defaultSender });

      await expectCreateCollectible(1, bob);

      // Sell 10 ETH for DUBI
      await expectMakeOrder({
        ...makeOrder(),
        takerContractAddress: deployment.Heroes.address,
        takerValue: new BN(1),
        takerCurrencyType: CurrencyType.ERC721,
      }, { from: alice, value: ether("10") });

      // Buying the ETH fails while opted-in without going through booster
      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder().id.toString(),
        maker: makeOrder().maker,
        takerValue: new BN(1).toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        {
          from: bob,
        }
      ), "ERC721-8");

      // Give Dubiex approval to transfer bob's heroes
      await deployment.Heroes.setApprovalForAll(deployment.Dubiex.address, true, {
        from: bob,
        gas: 150_000,
      });

      // Still fails, because Heroes have special behavior and isn't transferred to Dubiex
      await expectRevert(deployment.Dubiex.takeOrder({
        id: makeOrder().id.toString(),
        maker: makeOrder().maker,
        takerValue: new BN(1).toString(),
        maxTakerMakerRatio: ether("1").toString(),
      },
        {
          from: bob,
        }
      ), "ERC721-8");
    });

    it("should cancel order for boostable token", async () => {
      await deployment.Dubi.mint(alice, ether("10"), { from: defaultSender });

      // Opted-in by default, so the make order fails because Dubiex cannot
      // move funds from DUBI contract
      await expectRevert(expectMakeOrder({
        ...makeOrder(),
        makerContractAddress: deployment.Dubi.address,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
      }, { from: alice, value: ether("10"), gas: 500000 }), "ERC20-17");

      // Opt-out
      await optIn.instantOptOut(alice, { from: deployment.booster });

      // Sell 10 DUBI for ETH while opted-out
      await expectMakeOrder({
        ...makeOrder(),
        makerContractAddress: deployment.Dubi.address,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
      }, { from: alice, value: ether("10"), gas: 500000 });

      // Now opt-in again
      await optIn.optIn(deployment.booster, { from: alice });

      // Cancelling works when not going through booster
      await expectCancelOrder(makeOrder().maker, makeOrder().id, { from: alice });
    });

    it("should cancel order for non-boostable token", async () => {
      await vanillaERC20Token.mint(bob, ether("10"), { from: defaultSender });

      // Sell 10 ETH for DummyToken (ERC20)
      await expectMakeOrder({
        ...makeOrder(),
        takerContractAddress: vanillaERC20Token.address,
        takerCurrencyType: CurrencyType.ERC20,
      }, { from: alice, value: ether("10") });

      // Cancelling while opted-in without going through booster is fine
      await expectCancelOrder(makeOrder().maker, makeOrder().id, { from: alice });
    });

  });

  describe("Boosted", () => {

    it("should make order (selling ETH for DUBI)", async () => {
      const [boostedAlice] = deployment.boostedAddresses;

      const order = makeOrder();
      const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: order.makerValue,
        takerValue: order.takerValue,
        makerContractAddress: order.makerContractAddress,
        takerContractAddress: order.takerContractAddress,
        makerCurrencyType: order.makerCurrencyType,
        takerCurrencyType: order.takerCurrencyType,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectMakeOrder(order,
        {
          from: deployment.booster,
          // Booster must pay the ETH for alice!
          value: ether("10")
        }, {
        message,
        signature,
      });
    });

    it("should make order (selling ETH for DUBI and refund excess ETH)", async () => {
      const [boostedAlice] = deployment.boostedAddresses;

      const order = makeOrder();
      const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: order.makerValue,
        takerValue: order.takerValue,
        makerContractAddress: order.makerContractAddress,
        takerContractAddress: order.takerContractAddress,
        makerCurrencyType: order.makerCurrencyType,
        takerCurrencyType: order.takerCurrencyType,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectMakeOrder(order,
        {
          from: deployment.booster,
          // Booster sends 100 ETH, but the order requires only 10 - dubiex refunds the excess
          value: ether("100")
        }, {
        message,
        signature,
      });

    });

    it("should make orders (selling ETH for DUBI and refund excess ETH)", async () => {
      const [boostedAlice] = deployment.boostedAddresses;

      const order = makeOrder();

      const messages: any[] = [];
      const signatures: any[] = [];

      for (let i = 0; i < 10; i++) {
        const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
          makerValue: order.makerValue,
          takerValue: order.takerValue,
          makerContractAddress: order.makerContractAddress,
          takerContractAddress: order.takerContractAddress,
          makerCurrencyType: order.makerCurrencyType,
          takerCurrencyType: order.takerCurrencyType,
          nonce: new BN(i + 1),
          verifyingContract: deployment.Dubiex.address,
          booster: deployment.booster,
          maker: boostedAlice.address,
          signer: boostedAlice,
        });

        messages.push(message);
        signatures.push(signature);
      }

      const boosterEthBefore = new BN(await deployment.web3.eth.getBalance(deployment.booster));
      const aliceEthBefore = new BN(await deployment.web3.eth.getBalance(alice));

      const receipt = await deployment.Dubiex.boostedMakeOrderBatch(messages, signatures, {
        from: deployment.booster,
        value: ether("100"), /* send more ETH than needed (100) */
        gas: 2_000_000,
      });

      console.log(receipt.receipt.gasUsed);

      const boosterEthAfter = new BN(await deployment.web3.eth.getBalance(deployment.booster));
      const aliceEthAfter = new BN(await deployment.web3.eth.getBalance(alice));

      // Eth is paid by booster, assume alice already gave booster some ETH beforehand
      expectBigNumber(aliceEthAfter, aliceEthBefore);

      const gasPaidInWei = new BN(20e9).mul(new BN(receipt.receipt.gasUsed));
      expectBigNumber(boosterEthAfter, boosterEthBefore.sub(order.makerValue.mul(new BN(10))).sub(gasPaidInWei));
    });

    it("should update orders and not revert", async () => {
      const [boostedAlice] = deployment.boostedAddresses;
      await deployment.Dubi.mint(bob, ether("1000"));

      await optIn.instantOptOut(bob, { from: deployment.booster });

      const order = makeOrder();

      let messages: any[] = [];
      let signatures: any[] = [];

      for (let i = 0; i < 3; i++) {
        const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
          makerValue: order.makerValue,
          takerValue: order.takerValue,
          makerContractAddress: order.makerContractAddress,
          takerContractAddress: order.takerContractAddress,
          makerCurrencyType: order.makerCurrencyType,
          takerCurrencyType: order.takerCurrencyType,
          nonce: new BN(i + 1),
          verifyingContract: deployment.Dubiex.address,
          booster: deployment.booster,
          maker: boostedAlice.address,
          signer: boostedAlice,
        });

        messages.push(message);
        signatures.push(signature);
      }

      await deployment.Dubiex.boostedMakeOrderBatch(messages, signatures, {
        from: deployment.booster,
        value: ether("30"),
        gas: 2_000_000,
      });

      // Now fill the second order with bob
      await expectTakeOrder({ maker: boostedAlice.address, id: "2", takerValue: ether("10"), txDetails: { from: bob } });

      // Order is gone
      await expectDeletedOrder(boostedAlice.address, "2");

      // Update all previous three stable orders with alice
      messages = [];
      signatures = [];

      for (let i = 0; i < 3; i++) {
        const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
          makerValue: order.makerValue,
          takerValue: order.takerValue,
          makerContractAddress: order.makerContractAddress,
          takerContractAddress: order.takerContractAddress,
          makerCurrencyType: order.makerCurrencyType,
          takerCurrencyType: order.takerCurrencyType,
          nonce: new BN(i + 4),
          verifyingContract: deployment.Dubiex.address,
          updatedRatioWei: ether("1"),
          orderId: new BN(i + 1),
          booster: deployment.booster,
          maker: boostedAlice.address,
          signer: boostedAlice,
        });

        messages.push(message);
        signatures.push(signature);
      }

      // Succeeds without reverting
      await deployment.Dubiex.boostedMakeOrderBatch(messages, signatures, {
        from: deployment.booster,
        value: ether("30"),
        gas: 2_000_000,
      });

      // Order still gone
      await expectDeletedOrder(boostedAlice.address, "2");

    });

    it("should make order when selling DUBI (boostable) for ETH", async () => {
      const [boostedAlice] = deployment.boostedAddresses;
      await deployment.Dubi.mint(boostedAlice.address, ether("10"), { from: defaultSender });

      const order = {
        ...makeOrder(),
        makerContractAddress: deployment.Dubi.address,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: constants.ZERO_ADDRESS,
        takerCurrencyType: CurrencyType.ETH,
      }

      const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: order.makerValue,
        takerValue: order.takerValue,
        makerContractAddress: deployment.Dubi.address,
        takerContractAddress: constants.ZERO_ADDRESS,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerCurrencyType: CurrencyType.ETH,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectMakeOrder(order, { from: deployment.booster }, { message, signature });
    });

    it("should upsert DUBI sell order", async () => {
      const [boostedAlice] = deployment.boostedAddresses;
      await deployment.Dubi.mint(boostedAlice.address, ether("10"), { from: defaultSender });

      const order = {
        ...makeOrder(),
        makerContractAddress: deployment.Dubi.address,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerContractAddress: constants.ZERO_ADDRESS,
        takerCurrencyType: CurrencyType.ETH,
      }

      let { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: order.makerValue,
        takerValue: order.takerValue,
        makerContractAddress: deployment.Dubi.address,
        takerContractAddress: constants.ZERO_ADDRESS,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerCurrencyType: CurrencyType.ETH,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectMakeOrder(order, { from: deployment.booster }, { message, signature });

      let _order = await getOrder(boostedAlice.address, "1");
      expectBigNumber(_order.takerValue, ether("10"));

      ({ message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: order.makerValue,
        takerValue: order.takerValue,
        makerContractAddress: deployment.Dubi.address,
        takerContractAddress: constants.ZERO_ADDRESS,
        makerCurrencyType: CurrencyType.BOOSTABLE_ERC20,
        takerCurrencyType: CurrencyType.ETH,
        nonce: new BN(2),
        orderId: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
        updatedRatioWei: ether("2").toString(),
      }));

      await deployment.Dubiex.boostedMakeOrder(message, signature, { from: deployment.booster });

      _order = await getOrder(boostedAlice.address, "1");
      expectBigNumber(_order.takerValue, ether("20"))

    });

    it("should make order when selling hero for ETH", async () => {
      const [boostedAlice] = deployment.boostedAddresses;

      await expectCreateCollectible(1, boostedAlice.address);

      const order = {
        ...makeOrder(),
        makerValue: new BN(1),
        makerContractAddress: deployment.Heroes.address,
        makerCurrencyType: CurrencyType.ERC721,
        takerContractAddress: constants.ZERO_ADDRESS,
        takerCurrencyType: CurrencyType.ETH,
      }

      const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: order.makerValue,
        takerValue: order.takerValue,
        makerContractAddress: deployment.Heroes.address,
        takerContractAddress: constants.ZERO_ADDRESS,
        makerCurrencyType: CurrencyType.ERC721,
        takerCurrencyType: CurrencyType.ETH,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectMakeOrder(order, { from: deployment.booster }, { message, signature });
    });

    it("should fail to make order when selling DUBI (ERC20) for ETH", async () => {
      const [boostedAlice] = deployment.boostedAddresses;
      await deployment.Dubi.mint(boostedAlice.address, ether("10"), { from: defaultSender });

      const order = {
        ...makeOrder(),
        makerContractAddress: deployment.Dubi.address,
        makerCurrencyType: CurrencyType.ERC20,
        takerContractAddress: constants.ZERO_ADDRESS,
        takerCurrencyType: CurrencyType.ETH,
      }

      // fails for PRPS/DUBI because transferFrom only works when opted-out
      const { message, signature } = await createSignedBoostedMakeOrderMessage(deployment.web3, {
        makerValue: order.makerValue,
        takerValue: order.takerValue,
        makerContractAddress: deployment.Dubi.address,
        makerCurrencyType: CurrencyType.ERC20,
        takerContractAddress: constants.ZERO_ADDRESS,
        takerCurrencyType: CurrencyType.ETH,
        nonce: new BN(1),
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
      });

      await expectRevert(deployment.Dubiex.boostedMakeOrder(message, signature, { from: deployment.booster }),
        "ERC20-7");
    });

    it("should take order selling DUBI for ETH", async () => {
      // Sell 10 ETH for 10 DUBI
      await optIn.instantOptOut(alice, { from: deployment.booster });

      const order = makeOrder();
      await expectMakeOrder(order, { from: alice, value: ether("10") });


      const [_, boostedBob] = deployment.boostedAddresses;

      await deployment.Dubi.mint(boostedBob.address, ether("10"), { from: defaultSender });

      const takeOrder = {
        maker: order.maker,
        id: order.id,
        takerValue: ether("10"),
      }

      const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
        maker: order.maker,
        id: order.id,
        takerValue: ether("10"),
        taker: boostedBob.address,
        nonce: new BN(1),
        signer: boostedBob,
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
      });

      await expectTakeOrder({
        ...takeOrder,
        eip712: {
          message, signature,
        },
        txDetails: { from: deployment.booster },
      });
    });

    it("should take order selling DUBI for ETH and refund excess ETH", async () => {
      // Sell 10 ETH for 10 DUBI
      await optIn.instantOptOut(alice, { from: deployment.booster });

      const order = makeOrder();
      order.makerCurrencyType = CurrencyType.BOOSTABLE_ERC20;
      order.makerContractAddress = deployment.Dubi.address;
      order.makerValue = ether("10");
      order.takerCurrencyType = CurrencyType.ETH;
      order.takerContractAddress = constants.ZERO_ADDRESS;
      order.takerValue = ether("10");

      await deployment.Dubi.mint(alice, ether("10"));

      await expectMakeOrder(order, { from: alice });

      const [_, boostedBob] = deployment.boostedAddresses;

      const takeOrder = {
        maker: order.maker,
        id: order.id,
        takerValue: ether("10"),
      }

      const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
        maker: order.maker,
        id: order.id,
        takerValue: ether("10"),
        taker: boostedBob.address,
        nonce: new BN(1),
        signer: boostedBob,
        verifyingContract: deployment.Dubiex.address,
        booster: deployment.booster,
      });

      await expectTakeOrder({
        ...takeOrder,
        eip712: {
          message, signature,
        },
        txDetails: {
          from: deployment.booster,
          gas: 500_000,
          // Booster sends 100 ETH, even though the order only requires 10. The excess gets refunded
          value: ether("100"),
        },
      });
    });

    it("should take orders", async () => {
      // Sell 10 ETH for 10 DUBI
      await optIn.instantOptOut(alice, { from: deployment.booster });

      const order = makeOrder();
      await expectMakeOrder(order, { from: alice, value: ether("10") });

      const [_, boostedBob] = deployment.boostedAddresses;
      await deployment.Dubi.mint(boostedBob.address, ether("10"), { from: defaultSender });

      await expectApprove(deployment.Dubi.address, CurrencyType.BOOSTABLE_ERC20, ZERO, { from: bob });

      const messages: any[] = [];
      const signatures: any[] = [];

      // Take order 10 times, by filling 1 DUBI each time
      for (let i = 0; i < 10; i++) {
        const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
          maker: order.maker,
          id: order.id,
          takerValue: ether("1"),
          taker: boostedBob.address,
          nonce: new BN(i + 1),
          signer: boostedBob,
          verifyingContract: deployment.Dubiex.address,
          booster: deployment.booster,
        });

        messages.push(message);
        signatures.push(signature);
      }

      await deployment.Dubiex.boostedTakeOrderBatch(messages, signatures, { from: deployment.booster });
      expectBigNumber(await deployment.Dubi.balanceOf(boostedBob.address), ZERO);
      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("10"));
    });

    it("should take orders and not revert if any doesn't exist", async () => {
      // Sell 10 ETH for 10 DUBI
      await optIn.instantOptOut(alice, { from: deployment.booster });

      const order = makeOrder();
      await expectMakeOrder(order, { from: alice, value: ether("10") });

      const [_, boostedBob] = deployment.boostedAddresses;
      await deployment.Dubi.mint(boostedBob.address, ether("10"), { from: defaultSender });

      await expectApprove(deployment.Dubi.address, CurrencyType.BOOSTABLE_ERC20, ZERO, { from: bob });

      const messages: any[] = [];
      const signatures: any[] = [];

      // Call take order on 5 orders where only the first exists.
      for (let i = 0; i < 5; i++) {
        const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
          maker: order.maker,
          id: new BN(i + 1),
          takerValue: ether("10"),
          taker: boostedBob.address,
          nonce: new BN(i + 1),
          signer: boostedBob,
          verifyingContract: deployment.Dubiex.address,
          booster: deployment.booster,
        });

        messages.push(message);
        signatures.push(signature);
      }

      // Didn't revert and took the existing order
      await deployment.Dubiex.boostedTakeOrderBatch(messages, signatures, { from: deployment.booster });
      expectBigNumber(await deployment.Dubi.balanceOf(boostedBob.address), ZERO);
      expectBigNumber(await deployment.Dubi.balanceOf(alice), ether("10"));
      await expectDeletedOrder(alice, "1");
    });

    it("should take orders and refund excess ETH", async () => {
      // Sell 10 ETH for 10 DUBI
      await optIn.instantOptOut(alice, { from: deployment.booster });

      const order = makeOrder();
      order.makerCurrencyType = CurrencyType.BOOSTABLE_ERC20;
      order.makerContractAddress = deployment.Dubi.address;
      order.makerValue = ether("10");
      order.takerCurrencyType = CurrencyType.ETH;
      order.takerContractAddress = constants.ZERO_ADDRESS;
      order.takerValue = ether("10");

      await deployment.Dubi.mint(alice, ether("10"), { from: defaultSender });

      await expectMakeOrder(order, { from: alice });

      const [_, boostedBob] = deployment.boostedAddresses;

      await expectApprove(deployment.Dubi.address, CurrencyType.BOOSTABLE_ERC20, ZERO, { from: bob });

      const messages: any[] = [];
      const signatures: any[] = [];

      // Take order 10 times, by filling 1 DUBI each time
      for (let i = 0; i < 10; i++) {
        const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
          maker: order.maker,
          id: order.id,
          takerValue: ether("1"),
          taker: boostedBob.address,
          nonce: new BN(i + 1),
          signer: boostedBob,
          verifyingContract: deployment.Dubiex.address,
          booster: deployment.booster,
        });

        messages.push(message);
        signatures.push(signature);
      }

      const boosterEthBefore = new BN(await deployment.web3.eth.getBalance(deployment.booster));
      const aliceEthBefore = new BN(await deployment.web3.eth.getBalance(alice));

      const receipt = await deployment.Dubiex.boostedTakeOrderBatch(messages, signatures, {
        from: deployment.booster,
        value: ether("1000"), /*send more ETH than needed  */
        gas: 2_000_000,
      });

      const boosterEthAfter = new BN(await deployment.web3.eth.getBalance(deployment.booster));
      const aliceEthAfter = new BN(await deployment.web3.eth.getBalance(alice));

      expectBigNumber(aliceEthAfter, aliceEthBefore.add(order.takerValue));
      const gasPaidInWei = new BN(20e9).mul(new BN(receipt.receipt.gasUsed));
      expectBigNumber(boosterEthAfter, boosterEthBefore.sub(order.takerValue).sub(gasPaidInWei));

      expectBigNumber(await deployment.Dubi.balanceOf(boostedBob.address), ether("10"));
      expectBigNumber(await deployment.Dubi.balanceOf(alice), ZERO);
    });

    it("should scoop up order with many successors in one take order batch transaction", async () => {
      await optIn.instantOptOut(alice, { from: deployment.booster });

      // Create a stable order with four successors
      // i.e. order 1 -> order 2 -> order 3 -> order 4 -> order5
      //
      // When order 1 is filled, order 2 becomes visible and so on.
      const order1: any = makeOrder();
      await expectMakeOrder(order1, { from: alice, value: ether("10") });

      for (let i = 0; i < 5; i++) {
        const successor = makeOrder();
        successor.makerValue = ether(`${10 * (i + 2)}`);
        successor.id = new BN(i + 2);
        successor.ancestorOrderId = new BN(i + 1);
        await expectMakeOrder(successor, { from: alice, value: successor.makerValue });
      }

      // Now the orderbook looks like this:
      // order 1:       sell 10 ETH 10 DUBI, successor order 2
      // hiddenOrder 2: sell 20 ETH 10 DUBI, successor order 3
      // hiddenOrder 3: sell 30 ETH 10 DUBI, successor order 4
      // hiddenOrder 4: sell 40 ETH 10 DUBI, successor order 5
      // hiddenOrder 5: sell 50 ETH 10 DUBI, no successor
      const expectSuccessorsHidden = async (headOrderId: number, orderIds: number[]) => {
        expect((await getOrder(alice, headOrderId)).isHidden).to.be.false;

        for (const orderId of orderIds) {
          expect((await getOrder(alice, orderId)).isHidden).to.be.true;
        }
      }

      let successorIds = [2, 3, 4, 5];
      await expectSuccessorsHidden(1, successorIds);

      // Prepare batch take order
      const [_, boostedBob] = deployment.boostedAddresses;

      await deployment.Dubi.mint(boostedBob.address, ether("50"));

      const ethBalanceBefore = new BN(await deployment.web3.eth.getBalance(boostedBob.address));

      const messages: any[] = [];
      const signatures: any[] = [];

      // Scoop up all 5 orders in a single call
      for (let i = 0; i < 5; i++) {
        const { message, signature } = await createSignedBoostedTakeOrderMessage(deployment.web3, {
          maker: alice,
          id: new BN(i + 1),
          takerValue: ether("10"),
          taker: boostedBob.address,
          nonce: new BN(i + 1),
          maxTakerMakerRatio: ether(`${10 * (i + 1)}`),
          signer: boostedBob,
          verifyingContract: deployment.Dubiex.address,
          booster: deployment.booster,
        });

        messages.push(message);
        signatures.push(signature);
      }

      const receipt = await deployment.Dubiex.boostedTakeOrderBatch(messages, signatures, { from: deployment.booster, gas: 2_000_000 });
      // console.log(receipt.receipt.gasUsed);

      // Bought 150 ETH in total for 50 DUBI
      const ethBalanceAfter = new BN(await deployment.web3.eth.getBalance(boostedBob.address));

      expectBigNumber(await deployment.Dubi.balanceOf(boostedBob.address), ZERO);
      expectBigNumber(ethBalanceAfter, ethBalanceBefore.add(ether("150")));
    });

    it("should cancel order", async () => {
      const [boostedAlice] = deployment.boostedAddresses;

      const order = makeOrder();
      order.maker = boostedAlice.address;

      await expectMakeOrder(order, { from: boostedAlice.address, value: ether("10") });

      const { message, signature } = await createSignedBoostedCancelOrderMessage(deployment.web3, {
        id: order.id,
        nonce: new BN(1),
        booster: deployment.booster,
        maker: boostedAlice.address,
        signer: boostedAlice,
        verifyingContract: deployment.Dubiex.address,
      });

      await deployment.Dubiex.boostedCancelOrder(message, signature, { from: deployment.booster });
      await expectDeletedOrder(order.maker, order.id);
    });

    it("should batch cancel orders", async () => {
      const [boostedAlice] = deployment.boostedAddresses;

      const order = makeOrder();
      order.maker = boostedAlice.address;

      const messages: any[] = [];
      const signatures: any[] = [];

      for (let i = 0; i < 5; i++) {
        order.id = new BN(i + 1);
        await expectMakeOrder({ ...order, id: order.id }, { from: boostedAlice.address, value: ether("10") });

        const { message, signature } = await createSignedBoostedCancelOrderMessage(deployment.web3, {
          id: order.id,
          nonce: new BN(i + 1),
          booster: deployment.booster,
          maker: boostedAlice.address,
          signer: boostedAlice,
          verifyingContract: deployment.Dubiex.address,
        });

        messages.push(message);
        signatures.push(signature);
      }

      await deployment.Dubiex.boostedCancelOrderBatch(messages, signatures, { from: deployment.booster });

      for (let i = 0; i < 5; i++) {
        await expectDeletedOrder(order.maker, new BN(i + 1));
      }
    });

    it("should batch cancel orders and not revert if any doesn't exist", async () => {
      const [boostedAlice] = deployment.boostedAddresses;

      const order = makeOrder();
      order.maker = boostedAlice.address;

      const messages: any[] = [];
      const signatures: any[] = [];

      await expectMakeOrder(order, { from: boostedAlice.address, value: ether("10") });

      // Cancel 5 orders where only the first exists
      for (let i = 0; i < 5; i++) {
        const { message, signature } = await createSignedBoostedCancelOrderMessage(deployment.web3, {
          id: order.id,
          nonce: new BN(i + 1),
          booster: deployment.booster,
          maker: boostedAlice.address,
          signer: boostedAlice,
          verifyingContract: deployment.Dubiex.address,
        });

        messages.push(message);
        signatures.push(signature);
      }

      // Doesn't revert and deletes the first order
      await deployment.Dubiex.boostedCancelOrderBatch(messages, signatures, { from: deployment.booster });

      for (let i = 0; i < 5; i++) {
        await expectDeletedOrder(order.maker, new BN(i + 1));
      }
    });
  });

});

const expectApprove = async (contractAddress: string, currencyType: CurrencyType, value: any, details: Truffle.TransactionDetails): Promise<void> => {
  switch (currencyType) {
    case CurrencyType.ERC20:
      switch (contractAddress) {
        case vanillaERC20Token.address:
          await vanillaERC20Token.approve(deployment.Dubiex.address, value, details);
          break;
        case deployment.Purpose.address:
          await deployment.Purpose.approve(deployment.Dubiex.address, value, details);
          break;
        case deployment.Dubi.address:
          await deployment.Dubi.approve(deployment.Dubiex.address, value, details);
          break;
      }

      break;

    case CurrencyType.ERC721:
      // approve dubiex to manage collectibles of sender
      let receipt;
      switch (contractAddress) {
        case deployment.Heroes.address:
          // receipt = await deployment.Heroes.setApprovalForAll(deployment.Dubiex.address, true, {
          //   from: details.from,
          //   gas: 150_000,
          // });

          // await expectEvent(receipt, "ApprovalForAll", {
          //   owner: details.from,
          //   operator: deployment.Dubiex.address,
          //   approved: true,
          // });

          break;

        case deployment.Pets.address:
          // receipt = await deployment.Pets.setApprovalForAll(deployment.Dubiex.address, true, {
          //   from: details.from,
          //   gas: 150_000,
          // });

          // await expectEvent(receipt, "ApprovalForAll", {
          //   owner: details.from,
          //   operator: deployment.Dubiex.address,
          //   approved: true,
          // });

          break;
        case vanillaERC721Token.address:
          receipt = await vanillaERC721Token.setApprovalForAll(deployment.Dubiex.address, true, { from: details.from });
          await expectEvent(receipt, "ApprovalForAll", {
            owner: details.from,
            operator: deployment.Dubiex.address,
            approved: true,
          });
          break;
      }

      break;
    case CurrencyType.BOOSTABLE_ERC20:
      switch (contractAddress) {
        case deployment.Purpose.address:
          // await deployment.Purpose.approve(deployment.Dubiex.address, value, { from: details.from });
          break;
        case deployment.Dubi.address:
          // await deployment.Dubi.approve(deployment.Dubiex.address, value, { from: details.from });
          break;
      }

      break;
    case CurrencyType.ETH:
      // nothing to do
      break;
  }
}

const balanceOf = async (contractAddress: string, currencyType: CurrencyType, tokenHolder: string, tokenId: BN): Promise<any> => {
  switch (currencyType) {
    case CurrencyType.ERC20:
      switch (contractAddress) {
        case vanillaERC20Token.address:
          return new BN(await vanillaERC20Token.balanceOf(tokenHolder))
        case deployment.Purpose.address:
          return new BN(await deployment.Purpose.balanceOf(tokenHolder))
        case deployment.Dubi.address:
          return new BN(await deployment.Dubi.balanceOf(tokenHolder))
      }

    case CurrencyType.ERC721:
      switch (contractAddress) {
        case deployment.Heroes.address:
          try {
            const owner = await deployment.Heroes.ownerOf(tokenId.toNumber());
            return owner === tokenHolder ? new BN(1) : ZERO;
          } catch {
            // ownerOf reverts if it doesn't exist, so the balance is "1"
            return ZERO;
          }

        case deployment.Pets.address:
          try {
            const owner = await deployment.Pets.ownerOf(tokenId.toNumber());
            return owner === tokenHolder ? new BN(1) : ZERO;
          } catch {
            // ownerOf reverts if it doesn't exist, so the balance is "1"
            return ZERO;
          }

        case vanillaERC721Token.address:
          try {
            const owner = await vanillaERC721Token.ownerOf(tokenId.toNumber());
            return owner === tokenHolder ? new BN(1) : ZERO;
          } catch {
            // ownerOf reverts if it doesn't exist, so the balance is "1"
            return ZERO;
          }
      }

    case CurrencyType.BOOSTABLE_ERC20:
      switch (contractAddress) {
        case deployment.Purpose.address:
          return deployment.Purpose.balanceOf(tokenHolder);
        case deployment.Dubi.address:
          return deployment.Dubi.balanceOf(tokenHolder);
      }

    case CurrencyType.ETH:
      return new BN(await deployment.web3.eth.getBalance(tokenHolder));
  }
}

const expectMakeOrder = async (order: Order, details: Truffle.TransactionDetails, eip712?: {
  message: any, signature: { r: string, s: string, v: number };
}): Promise<void> => {
  const makerBalanceBefore = await balanceOf(order.makerContractAddress, order.makerCurrencyType, order.makerCurrencyType !== CurrencyType.ETH ? (eip712?.message.maker || details.from!) : details.from!, order.makerValue);

  await expectApprove(order.makerContractAddress, order.makerCurrencyType, order.makerValue, details);

  let nonceBefore;
  let nonceAfter;

  let receipt;
  if (eip712) {
    nonceBefore = await deployment.Dubiex.getNonce(eip712.message.maker);

    receipt = await deployment.Dubiex.boostedMakeOrder(eip712.message, eip712.signature, details);
    console.log("BOOSTED MAKE ORDER" + receipt.receipt.gasUsed);

    nonceAfter = await deployment.Dubiex.getNonce(eip712.message.maker);

    // Nonce is increased when selling non-ERC721 currencies
    if (order.makerCurrencyType !== CurrencyType.ERC721) {
      expectBigNumber(nonceAfter, nonceBefore.add(new BN(1)));
    } else {
      expectBigNumber(nonceAfter, nonceBefore);
    }

  } else {
    receipt = await deployment.Dubiex.makeOrder({
      makerValue: order.makerValue.toString(),
      takerValue: order.takerValue.toString(),
      pair: {
        makerContractAddress: order.makerContractAddress,
        takerContractAddress: order.takerContractAddress,
        makerCurrencyType: order.makerCurrencyType,
        takerCurrencyType: order.takerCurrencyType,
      },
      orderId: (order.orderId || ZERO).toString(),
      ancestorOrderId: (order.ancestorOrderId || ZERO).toString(),
      updatedRatioWei: (order.ratio || ZERO).toString(),
    },
      details,
    );
    console.log("MAKE ORDER" + receipt.receipt.gasUsed);
  }

  // Create order pair hash and compare it to the created pair on-chain
  //   bytes32 orderPairHash = keccak256(
  //     abi.encode(
  //         pair.makerContractAddress,
  //         pair.takerContractAddress,
  //         pair.makerCurrencyType,
  //         pair.takerCurrencyType
  //     )
  // );
  const orderPairHash = createOrderPairHash(order.makerContractAddress,
    order.takerContractAddress,
    order.makerCurrencyType,
    order.takerCurrencyType
  );

  // PACKED DATA
  const orderPairAlias = (await deployment.Dubiex.getOrderPairAliasByHash(orderPairHash)).toNumber();
  const packedData = packDataFromOrderEvent(order.makerValue, order.takerValue, orderPairAlias);

  await expectEvent(receipt, 'MadeOrder', {
    maker: eip712?.message.maker || details.from,
    id: new BN(order.id),
    packedData,
  });

  let asserted;
  for (const log of receipt.logs) {
    if (log.event === "MadeOrder") {
      const packed = log.args.packedData;
      const unpacked = unpackPackedDataFromOrderEvent(packed);
      expectBigNumber(unpacked.makerValue, order.makerValue);
      expectBigNumber(unpacked.takerValue, order.takerValue);
      expect(unpacked.orderPairAlias).to.eq(orderPairAlias);
      asserted = true;
      break;
    }
  }

  expect(asserted).to.be.true;

  const orderPair = await deployment.Dubiex.getOrderPairByHash(orderPairHash);
  expect(orderPair.makerContractAddress.toLowerCase()).to.eq(order.makerContractAddress.toLowerCase());
  expect(orderPair.takerContractAddress.toLowerCase()).to.eq(order.takerContractAddress.toLowerCase());
  expect(+orderPair.makerCurrencyType.toString()).to.eq(order.makerCurrencyType);
  expect(+orderPair.takerCurrencyType.toString()).to.eq(order.takerCurrencyType);

  const _order = await getOrder(eip712?.message.maker || order.maker, order.id);

  expectBigNumber(_order.id, new BN(order.id));
  expectBigNumber(_order.ancestorOrderId, new BN(order.ancestorOrderId || 0));
  expectBigNumber(_order.successorOrderId, new BN(order.successorOrderId || 0));
  expectBigNumber(_order.makerValue, order.makerValue);

  if (order.orderId === 0) {
    expectBigNumber(_order.takerValue, order.takerValue);
  }

  const makerBalanceAfter = await balanceOf(order.makerContractAddress, order.makerCurrencyType, order.makerCurrencyType !== CurrencyType.ETH ? (eip712?.message.maker || details.from!) : details.from!, order.makerValue);

  if (order.makerCurrencyType === CurrencyType.ETH) {
    // 20 gwei is configured price in unit tests
    const ethPaidForGas = new BN(20e9).mul(new BN(receipt.receipt.gasUsed));
    expectBigNumberApprox(makerBalanceAfter, makerBalanceBefore.sub(ethPaidForGas).sub(order.makerValue));
  } else if (order.makerCurrencyType === CurrencyType.ERC721) {
    expectBigNumber(makerBalanceBefore, new BN(1));
    expectBigNumber(makerBalanceAfter, ZERO);
    expectBigNumber(await balanceOf(order.makerContractAddress, order.makerCurrencyType, deployment.Dubiex.address, order.makerValue), new BN(1));
  } else {
    expectBigNumber(makerBalanceAfter, makerBalanceBefore.sub(order.makerValue));
  }
}

const expectUpdateOrder = async (order: Order, expectedTakerValue: BN, details: Truffle.TransactionDetails): Promise<void> => {
  // Get current order maker/takerValue
  const orderBeforeUpdate = await getOrder(order.maker, (order.orderId || order.id));

  const makerBalanceBefore = order.makerCurrencyType === CurrencyType.ERC721
    ? await balanceOf(order.makerContractAddress, order.makerCurrencyType, order.signer || details.from!, order.makerValue)
    : await balanceOf(order.makerContractAddress, order.makerCurrencyType, order.makerCurrencyType !== CurrencyType.ETH ? (order.signer || details.from!) : details.from!, order.makerValue);

  await expectApprove(order.makerContractAddress, order.makerCurrencyType, order.makerValue, details);

  const receipt = await deployment.Dubiex.makeOrder({
    makerValue: order.makerValue.toString(),
    takerValue: order.takerValue.toString(),
    pair: {
      makerContractAddress: order.makerContractAddress,
      takerContractAddress: order.takerContractAddress,
      makerCurrencyType: order.makerCurrencyType,
      takerCurrencyType: order.takerCurrencyType,
    },
    orderId: (order.orderId || ZERO).toString(),
    ancestorOrderId: (order.ancestorOrderId || ZERO).toString(),
    updatedRatioWei: (order.ratio || ZERO).toString(),
  },
    details,
  );

  const orderAfterUpdate = await getOrder(order.maker, order.orderId || order.id);

  if (orderBeforeUpdate.id.eq(ZERO)) {
    // console.log("MAKE: " + receipt.receipt.gasUsed);

    // Create order pair hash and compare it to the created pair on-chain
    //   bytes32 orderPairHash = keccak256(
    //     abi.encode(
    //         pair.makerContractAddress,
    //         pair.takerContractAddress,
    //         pair.makerCurrencyType,
    //         pair.takerCurrencyType
    //     )
    // );
    const orderPairHash = createOrderPairHash(order.makerContractAddress,
      order.takerContractAddress,
      order.makerCurrencyType,
      order.takerCurrencyType
    );

    const orderPairAlias = (await deployment.Dubiex.getOrderPairAliasByHash(orderPairHash)).toNumber();
    const packedData = packDataFromOrderEvent(order.makerValue, order.takerValue, orderPairAlias);

    await expectEvent(receipt, 'MadeOrder', {
      maker: order.signer || details.from,
      id: new BN(order.id),
      packedData,
    });

    let asserted;
    for (const log of receipt.logs) {
      if (log.event === "MadeOrder") {
        const packed = log.args.packedData;
        const unpacked = unpackPackedDataFromOrderEvent(packed);
        expectBigNumber(unpacked.makerValue, order.makerValue);
        expectBigNumber(unpacked.takerValue, order.takerValue);
        expect(unpacked.orderPairAlias).to.eq(orderPairAlias);
        asserted = true;
        break;
      }
    }

    expect(asserted).to.be.true;

  } else {
    console.log("UPSERT: " + receipt.receipt.gasUsed);
    await expectEvent(receipt, 'UpdatedOrder', {
      maker: order.signer || details.from,
      id: orderBeforeUpdate.id,
    });
  }

  const makerBalanceAfter = order.makerCurrencyType === CurrencyType.ERC721
    ? await balanceOf(order.makerContractAddress, order.makerCurrencyType, order.signer || details.from!, orderBeforeUpdate.makerValue as any/* makerValue is a tokenId */)
    : await balanceOf(order.makerContractAddress, order.makerCurrencyType, order.makerCurrencyType !== CurrencyType.ETH ? (order.signer || details.from!) : details.from!, order.makerValue);


  if (orderBeforeUpdate.id.eq(ZERO)) {
    expect(makerBalanceBefore.eq(makerBalanceAfter)).to.be.false;
    expectBigNumber(orderAfterUpdate.ancestorOrderId, order.ancestorOrderId || ZERO);
    expectBigNumber(orderAfterUpdate.successorOrderId, order.successorOrderId || ZERO);
    expectBigNumber(orderAfterUpdate.makerValue, order.makerValue);
    expectBigNumber(orderAfterUpdate.takerValue, order.takerValue);
  } else {
    expectBigNumber(orderAfterUpdate.ancestorOrderId, orderBeforeUpdate.ancestorOrderId) // unchanged
    expectBigNumber(orderAfterUpdate.successorOrderId, orderBeforeUpdate.successorOrderId) // unchanged

    // MakerValue didn't change
    expectBigNumber(orderAfterUpdate.makerValue, orderBeforeUpdate.makerValue);

    // TakerValue changed according to the ratio
    const makerValueBefore = orderBeforeUpdate.makerValue;
    const takerValueAfter = orderAfterUpdate.takerValue;

    expectBigNumber(takerValueAfter, (makerValueBefore as any).mul(order.ratio).div(ether("1")));
  }

  expectBigNumber(orderAfterUpdate.takerValue, expectedTakerValue);

}

const expectTakeOrder = async (
  { maker, id, takerValue, maxTakerMakerRatio, eip712, txDetails }: { maker: string; id: any; takerValue: any; maxTakerMakerRatio?: any, eip712?: { message: any, signature: { r: string, s: string, v: number }; }; txDetails: Truffle.TransactionDetails; }): Promise<Truffle.TransactionResponse> => {


  //
  // Get current maker/taker balances before taking the order
  //
  let _order = await getOrder(maker, id);
  const orderMakerValueBefore: any = _order.makerValue;
  const orderTakerValueBefore: any = _order.takerValue;

  let makerCurrencyType: any = _order.makerCurrencyType;
  let takerCurrencyType: any = _order.takerCurrencyType;

  const takerBalanceMakerContractBefore = await balanceOf(_order.makerContractAddress, makerCurrencyType, (eip712?.message.taker || txDetails.from!), orderMakerValueBefore);
  const takerBalanceTakerContractBefore = await balanceOf(_order.takerContractAddress, takerCurrencyType, takerCurrencyType === CurrencyType.ETH ? txDetails.from : (eip712?.message.taker || txDetails.from!), orderTakerValueBefore);

  const makerBalanceMakerContractBefore = await balanceOf(_order.makerContractAddress, makerCurrencyType, maker, orderMakerValueBefore);
  const makerBalanceTakerContractBefore = await balanceOf(_order.takerContractAddress, takerCurrencyType, maker, orderTakerValueBefore);

  const { makerValue: expectedMakerValue, takerValue: expectedTakerValue } = calculateValues(makerCurrencyType, takerCurrencyType, orderMakerValueBefore, orderTakerValueBefore, takerValue);
  const orderFilled = expectedTakerValue.cmp(orderTakerValueBefore) == 0;

  //
  // Ensure approval to take the order
  //
  await expectApprove(_order.takerContractAddress, takerCurrencyType, _order.takerValue, txDetails!);

  //
  // Take the order
  //

  if (!maxTakerMakerRatio) {
    maxTakerMakerRatio = _order.takerValue.mul(ether("1")).div(_order.makerValue);
  }

  let receipt;
  if (eip712) {
    receipt = await deployment.Dubiex.boostedTakeOrder(eip712.message, eip712.signature, txDetails);
  } else {
    receipt = await deployment.Dubiex.takeOrder({
      id: id.toString(),
      maker: maker,
      takerValue: takerValue.toString(),
      maxTakerMakerRatio: maxTakerMakerRatio.toString(),
    },
      {
        ...txDetails,
      },
    );

  }

  console.log("TAKE ORDER: " + receipt.receipt.gasUsed);

  const orderPairHash = createOrderPairHash(
    _order.makerContractAddress,
    _order.takerContractAddress,
    _order.makerCurrencyType,
    _order.takerCurrencyType,
  );

  const orderPairAlias = (await deployment.Dubiex.getOrderPairAliasByHash(orderPairHash)).toNumber();

  const packedData = packDataFromOrderEvent(expectedMakerValue, expectedTakerValue, orderPairAlias);

  await expectEvent(receipt, 'TookOrder', {
    maker,
    id: new BN(id),
    taker: eip712?.message.taker || txDetails!.from,
    packedData,
  });

  let asserted;
  for (const log of receipt.logs) {
    if (log.event === "TookOrder") {
      const packed = log.args.packedData;
      const unpacked = unpackPackedDataFromOrderEvent(packed);
      expectBigNumber(unpacked.makerValue, expectedMakerValue);
      expectBigNumber(unpacked.takerValue, expectedTakerValue);
      expect(unpacked.orderPairAlias).to.eq(orderPairAlias);
      asserted = true;
      break;
    }
  }

  expect(asserted).to.be.true;

  //
  // Get new maker/taker balances after taking the order
  //

  // The order no longer exists if it got filled completely.
  if (orderFilled) {
    await expectDeletedOrder(maker, id);
  } else {
    const partiallyFilledOrder = await getOrder(maker, id);
    const orderMakerValueAfter = partiallyFilledOrder.makerValue;
    const orderTakerValueAfter = partiallyFilledOrder.takerValue;
    expectBigNumber(orderMakerValueAfter, orderMakerValueBefore.sub(expectedMakerValue));
    expectBigNumber(orderTakerValueAfter, orderTakerValueBefore.sub(expectedTakerValue));
  }

  // We read from the order that got fetched before taking the order
  const makerContractAddress = _order.makerContractAddress;
  const takerContractAddress = _order.takerContractAddress;

  makerCurrencyType = _order.makerCurrencyType;
  takerCurrencyType = _order.takerCurrencyType;

  const takerBalanceMakerContractAfter = await balanceOf(makerContractAddress, makerCurrencyType, (eip712?.message.taker || txDetails.from!), orderMakerValueBefore);
  const takerBalanceTakerContractAfter = await balanceOf(takerContractAddress, takerCurrencyType, takerCurrencyType === CurrencyType.ETH ? txDetails.from : (eip712?.message.taker || txDetails.from!), orderTakerValueBefore);

  const makerBalanceMakerContractAfter = await balanceOf(makerContractAddress, makerCurrencyType, maker, orderMakerValueBefore);
  const makerBalanceTakerContractAfter = await balanceOf(takerContractAddress, takerCurrencyType, maker, orderTakerValueBefore);

  //
  // Assert new maker and taker balance
  //
  if (takerCurrencyType === CurrencyType.ERC721 || makerCurrencyType === CurrencyType.ERC721) {

    if (takerCurrencyType === CurrencyType.ERC721) {
      // Buying ERC721 increases "balance" by 1
      expectBigNumber(makerBalanceTakerContractAfter, makerBalanceTakerContractBefore.add(new BN("1")));

      if (makerContractAddress === takerContractAddress) {
        expectBigNumber(takerBalanceTakerContractAfter, ZERO);
        expectBigNumber(takerBalanceTakerContractBefore, new BN("1"));
      } else {
        expectBigNumber(takerBalanceTakerContractAfter, takerBalanceTakerContractBefore.sub(new BN("1")));
      }

    } else if (takerCurrencyType === CurrencyType.ETH) {
      expectBigNumberApprox(makerBalanceTakerContractAfter, makerBalanceTakerContractBefore.add(expectedTakerValue), ether("1").div(new BN("100")));
      expectBigNumberApprox(takerBalanceTakerContractAfter, takerBalanceTakerContractBefore.sub(expectedTakerValue), ether("1").div(new BN("100")));
    } else {
      expectBigNumber(makerBalanceTakerContractAfter, makerBalanceTakerContractBefore.add(expectedTakerValue));
      expectBigNumber(takerBalanceTakerContractAfter, takerBalanceTakerContractBefore.sub(expectedTakerValue));
    }

    if (takerCurrencyType === makerCurrencyType && makerContractAddress === takerContractAddress) {
      expectBigNumber(makerBalanceMakerContractBefore, ZERO);
      expectBigNumber(makerBalanceMakerContractAfter, ZERO);
      expectBigNumber(takerBalanceMakerContractBefore, ZERO);
      expectBigNumber(takerBalanceMakerContractAfter, new BN("1"));
    } else {
      // Else doesn't change
      expectBigNumber(makerBalanceMakerContractAfter, makerBalanceMakerContractBefore);

      if (makerCurrencyType === CurrencyType.ETH) {
        expectBigNumberApprox(takerBalanceMakerContractAfter, takerBalanceMakerContractBefore.add(expectedMakerValue), ether("1").div(new BN("100")));
      } else {
        expectBigNumber(takerBalanceMakerContractAfter, takerBalanceMakerContractBefore.add(expectedMakerValue));
      }
    }

  } else if ((takerCurrencyType === makerCurrencyType) || (makerCurrencyType === CurrencyType.BOOSTABLE_ERC20 && takerCurrencyType === CurrencyType.ERC20) || (makerCurrencyType === CurrencyType.ERC20 && takerCurrencyType === CurrencyType.BOOSTABLE_ERC20)) {

    //  Maker balance of maker contract changes by takerValue
    if (makerContractAddress === takerContractAddress) {
      expectBigNumber(makerBalanceMakerContractAfter, makerBalanceMakerContractBefore.add(expectedTakerValue));
      expectBigNumber(makerBalanceTakerContractAfter, makerBalanceMakerContractAfter);

      if (makerContractAddress === constants.ZERO_ADDRESS) {
        expectBigNumberApprox(takerBalanceMakerContractAfter, takerBalanceMakerContractBefore.add(expectedMakerValue).sub(expectedTakerValue), ether("1").div(new BN("100")));
      } else {
        expectBigNumber(takerBalanceMakerContractAfter, takerBalanceMakerContractBefore.add(expectedMakerValue).sub(expectedTakerValue));
      }

      expectBigNumber(takerBalanceTakerContractAfter, takerBalanceMakerContractAfter);
    } else {
      // Doesn't change for maker
      expectBigNumber(makerBalanceMakerContractAfter, makerBalanceMakerContractBefore);

      // Taker balance is increased by makerValue
      expectBigNumber(takerBalanceMakerContractAfter, takerBalanceMakerContractBefore.add(expectedMakerValue));
    }

  } else {
    // Maker balance of maker contract doesn't change, because all was deposited into the contract
    // the taker contract is a different one.
    expectBigNumber(makerBalanceMakerContractAfter, makerBalanceMakerContractBefore);
    expectBigNumber(makerBalanceTakerContractAfter, makerBalanceTakerContractBefore.add(expectedTakerValue));

    if (makerCurrencyType === CurrencyType.ETH) {
      // Taker balance of maker contract increases by what he bought
      expectBigNumberApprox(takerBalanceMakerContractAfter, takerBalanceMakerContractBefore.add(expectedMakerValue), ether("1").div(new BN("100")));
    } else {
      // Taker balance of maker contract increases by what he bought
      expectBigNumber(takerBalanceMakerContractAfter, takerBalanceMakerContractBefore.add(expectedMakerValue));
      expectBigNumber(makerBalanceTakerContractAfter, makerBalanceTakerContractBefore.add(expectedTakerValue));
    }

    if (takerCurrencyType === CurrencyType.ETH) {
      // Due to gas it is a bit less
      expectBigNumberApprox(takerBalanceTakerContractAfter, takerBalanceTakerContractBefore.sub(expectedTakerValue), ether("1").div(new BN("100")));
    } else {
      expectBigNumber(takerBalanceTakerContractAfter, takerBalanceTakerContractBefore.sub(expectedTakerValue))
    }
  }

  return receipt;
}

const expectCancelOrder = async (
  maker: string,
  id: any,
  txDetails: Truffle.TransactionDetails
) => {
  let _order = await getOrder(maker, id);

  const orderMakerValueBefore: any = _order.makerValue;
  const makerBalanceBefore = await balanceOf(_order.makerContractAddress, _order.makerCurrencyType, maker, orderMakerValueBefore);
  const dubiexBalanceBefore = await balanceOf(_order.makerContractAddress, _order.makerCurrencyType, deployment.Dubiex.address, orderMakerValueBefore);

  const receipt = await deployment.Dubiex.cancelOrder(
    { maker, id: id.toString() },
    txDetails,
  );

  await expectEvent(receipt, 'CanceledOrder', {
    maker,
    id: new BN(id),
  });

  await expectDeletedOrder(maker, id);

  const makerBalanceAfter = await balanceOf(_order.makerContractAddress, _order.makerCurrencyType, maker, orderMakerValueBefore);
  const dubiexBalanceAfter = await balanceOf(_order.makerContractAddress, _order.makerCurrencyType, deployment.Dubiex.address, orderMakerValueBefore);

  // Remaining `makerValue` of cancelled order goes back to maker
  if (_order.makerCurrencyType === CurrencyType.ETH) {
    expectBigNumberApprox(makerBalanceAfter, makerBalanceBefore.add(orderMakerValueBefore), ether("1").div(new BN("100")));
  } else {
    expectBigNumber(makerBalanceAfter, makerBalanceBefore.add(orderMakerValueBefore));
  }
  expectBigNumber(dubiexBalanceAfter, dubiexBalanceBefore.sub(orderMakerValueBefore));
}

const calculateValues = (makerCurrencyType: CurrencyType, takerCurrencyType: CurrencyType, orderMakerValue: any, orderTakerValue: any, takerValue: any): { makerValue: BN, takerValue: BN } => {
  if (makerCurrencyType === CurrencyType.ERC721 || takerCurrencyType === CurrencyType.ERC721) {
    return { makerValue: orderMakerValue, takerValue };
  }

  takerValue = takerValue.cmp(orderTakerValue) == 1 ? orderTakerValue : takerValue;

  return {
    // Taker gets makerValue proportionally to what he "fills" of the takerValue.
    makerValue: orderMakerValue
      .mul(ether("1"))
      .mul(takerValue)
      .div(orderTakerValue)
      .div(ether("1")),
    takerValue,
  }
}

const expectCreateCollectible = async (id: number, owner: string): Promise<void> => {
  const attributes = mockHeroAttributes();
  const packedData = packCollectibleData(deployment.Heroes, deployment, attributes);

  const receipt = await (deployment.Heroes.mint(id, owner, packedData.toString(), [], [], { from: defaultSender, gas: 1_000_000 }));
  await expectEvent(receipt, "Transfer", {
    from: constants.ZERO_ADDRESS,
    to: owner,
    tokenId: id.toString(),
  });
}

const expectDeletedOrder = async (maker: string, id: any): Promise<void> => {
  const order = await getOrder(maker, id);
  expectBigNumber(order.id, ZERO);
  expectBigNumber(order.ancestorOrderId, ZERO);
  expectBigNumber(order.successorOrderId, ZERO);
  expectBigNumber(order.makerValue, ZERO);
  expectBigNumber(order.takerValue, ZERO);
}

const getOrder = async (maker: string, id: any): Promise<any> => {
  const order: any = await deployment.Dubiex.getOrder(maker, new BN(id));
  order.id = new BN(order.id);
  order.makerValue = new BN(order.makerValue);
  order.takerValue = new BN(order.takerValue);
  order.makerContractAddress = order.pair.makerContractAddress;
  order.takerContractAddress = order.pair.takerContractAddress;
  order.makerCurrencyType = new BN(order.pair.makerCurrencyType).toNumber();
  order.takerCurrencyType = new BN(order.pair.takerCurrencyType).toNumber();
  order.isHidden = order.flags.isHidden;
  order.hasSuccessor = order.flags.hasSuccessor;

  return order;
}
