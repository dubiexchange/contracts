import { contract, web3 } from "@openzeppelin/test-environment";
import { BN, singletons, ether } from "@openzeppelin/test-helpers";
import { PurposeInstance, DubiInstance, HodlInstance, OptInInstance } from "@prps/solidity/types/contracts";
import { HeroesInstance, PetsInstance } from "@clashofstreamers/solidity/types/contracts";
import { encode } from "rlp";
import { expect } from "chai";
import { ZERO } from "@prps/solidity/lib/types";
import Web3 from "web3";

import PurposeArtifact from "@prps/solidity/build/contracts/Purpose.json";
import DubiArtifact from "@prps/solidity/build/contracts/Dubi.json";
import HodlArtifact from "@prps/solidity/build/contracts/Hodl.json";
import OptInArtifact from "@prps/solidity/build/contracts/OptIn.json";
import ProtectedBoostableLibArtifact from "@prps/solidity/build/contracts/ProtectedBoostableLib.json";
import HodlLibArtifact from "@prps/solidity/build/contracts/HodlLib.json";
import HeroesArtifact from "@clashofstreamers/solidity/build/contracts/Heroes.json";
import PetsArtifact from "@clashofstreamers/solidity/build/contracts/Pets.json";
import CosBoostableArtifact from "@clashofstreamers/solidity/build/contracts/CosBoostableLib.json";

import { DubiexDeployment } from "../src/types";
import { DubiexInstance } from "../types/contracts";

export enum CurrencyType {
    NULL = 0,
    ETH = 1,
    ERC20 = 2,
    BOOSTABLE_ERC20 = 3,
    ERC721 = 4,
}

export const deployTestnet = async (): Promise<DubiexDeployment> => {
    try {
        const admin: any = (await web3.eth.getAccounts())[0];

        await singletons.ERC1820Registry(admin);

        const Purpose = contract.fromABI(PurposeArtifact.abi, PurposeArtifact.bytecode);
        const Dubi = contract.fromABI(DubiArtifact.abi, DubiArtifact.bytecode);
        const OptIn = contract.fromABI(OptInArtifact.abi, OptInArtifact.bytecode);
        const Hodl = contract.fromABI(HodlArtifact.abi, HodlArtifact.bytecode);
        const ProtectedBoostableLib = contract.fromABI(ProtectedBoostableLibArtifact.abi, ProtectedBoostableLibArtifact.bytecode);
        const HodlLib = contract.fromABI(HodlLibArtifact.abi, HodlLibArtifact.bytecode);

        const Heroes = contract.fromABI(HeroesArtifact.abi, HeroesArtifact.bytecode);
        const Pets = contract.fromABI(PetsArtifact.abi, PetsArtifact.bytecode);
        const CosBoostableLib = contract.fromABI(CosBoostableArtifact.abi, CosBoostableArtifact.bytecode);

        const Dubiex = contract.fromArtifact("Dubiex")

        // Necessary to make the linking work
        await Purpose.detectNetwork()
        await Dubi.detectNetwork()
        await Hodl.detectNetwork()
        await Heroes.detectNetwork();
        await Pets.detectNetwork();

        // Link libraries
        const protectedBoostableLib = await ProtectedBoostableLib.new();
        Purpose.link("ProtectedBoostableLib", protectedBoostableLib.address);
        Dubi.link("ProtectedBoostableLib", protectedBoostableLib.address);
        Hodl.link("ProtectedBoostableLib", protectedBoostableLib.address);
        Heroes.link("ProtectedBoostableLib", protectedBoostableLib.address);
        Pets.link("ProtectedBoostableLib", protectedBoostableLib.address);

        const hodlLib = await HodlLib.new();
        Hodl.link("HodlLib", hodlLib.address);

        const cosBoostableLib = await CosBoostableLib.new();
        Heroes.link("CosBoostableLib", cosBoostableLib.address);
        Pets.link("CosBoostableLib", cosBoostableLib.address);

        // Calculate contract addresses
        const contractAddresses = await calculateContractAddresses(admin);

        // Pick 10th account for default booster
        const booster = (await web3.eth.getAccounts())[9];
        const optIn: OptInInstance = await OptIn.new(booster);

        const prps: PurposeInstance = await Purpose.new(ether("1000000"),
            contractAddresses.optIn,
            contractAddresses.dubi,
            contractAddresses.hodl,
            contractAddresses.heroes,
            contractAddresses.pets,
            contractAddresses.dubiex,
        );

        const dubi: DubiInstance = await Dubi.new(ether("0"),
            contractAddresses.optIn,
            contractAddresses.purpose,
            contractAddresses.hodl,
            contractAddresses.heroes,
            contractAddresses.pets,
            contractAddresses.dubiex,
        );

        const hodl: HodlInstance = await Hodl.new(
            contractAddresses.optIn,
            contractAddresses.purpose,
            contractAddresses.dubi,
            contractAddresses.heroes,
            contractAddresses.pets,
        );

        const heroes: HeroesInstance = await Heroes.new(
            contractAddresses.optIn,
            contractAddresses.purpose,
            contractAddresses.dubi,
            contractAddresses.hodl,
            contractAddresses.pets,
            contractAddresses.dubiex
        );

        const pets: PetsInstance = await Pets.new(
            contractAddresses.optIn,
            contractAddresses.purpose,
            contractAddresses.dubi,
            contractAddresses.hodl,
            contractAddresses.heroes,
            contractAddresses.dubiex
        );

        const dubiex: DubiexInstance = await Dubiex.new(contractAddresses.optIn, contractAddresses.purpose, contractAddresses.dubi);

        // Assert that the addresses got deployed to the pre-calculated ones
        assertDeployAddresses([
            { name: "OPTIN", instance: optIn, target: contractAddresses.optIn },
            { name: "PRPS", instance: prps, target: contractAddresses.purpose },
            { name: "DUBI", instance: dubi, target: contractAddresses.dubi },
            { name: "HODL", instance: hodl, target: contractAddresses.hodl },
            { name: "HEROES", instance: heroes, target: contractAddresses.heroes },
            { name: "PETS", instance: pets, target: contractAddresses.pets },
            { name: "DUBIEX", instance: dubiex, target: contractAddresses.dubiex },
        ]);

        return {
            web3: web3,
            booster,
            boostedAddresses: await createBoostedAddresses(admin),
            owner: admin,
            OptIn: optIn,
            Purpose: prps,
            Dubi: dubi,
            Hodl: hodl,
            Heroes: heroes,
            Pets: pets,
            Dubiex: dubiex,
            Libraries: {
                HodlLib: hodlLib.address,
                ProtectedBoostableLib: protectedBoostableLib.address,
            }
        };
    } catch (ex) {
        console.log(ex.stack);
        throw ex;
    }
}

const calculateContractAddresses = async (deployAddress: string): Promise<Record<string, any>> => {
    const nonce = await web3.eth.getTransactionCount(deployAddress, 'pending');

    return {
        optIn: calculateContractAddress(deployAddress, nonce),
        purpose: calculateContractAddress(deployAddress, nonce + 1),
        dubi: calculateContractAddress(deployAddress, nonce + 2),
        hodl: calculateContractAddress(deployAddress, nonce + 3),
        heroes: calculateContractAddress(deployAddress, nonce + 4),
        pets: calculateContractAddress(deployAddress, nonce + 5),
        dubiex: calculateContractAddress(deployAddress, nonce + 6),
    };
}

const createBoostedAddresses = async (owner: string): Promise<{ address: string, privateKey: string }[]> => {
    // To sign EIP712 messages we need access to the private key.
    // But there's no obvious way to obtain it from the non-deterministically
    // generated accounts that ganache seeds on start.
    // So create 5 dedicated accounts for use with booster.
    const boostedAddresses: { address: string, privateKey: string }[] = [];
    for (let i = 0; i < 5; i++) {
        const password = i.toString();
        const privateKey = web3.utils.sha3(password);

        const boostedAddress = web3.utils.toChecksumAddress(await web3.eth.personal.importRawKey(privateKey, password));
        expect(await web3.eth.personal.unlockAccount(boostedAddress, password, 9999999)).to.be.true;

        // Send some ETH
        await web3.eth.sendTransaction({ value: ether("100"), from: owner, to: boostedAddress });

        boostedAddresses.push({
            address: boostedAddress,
            privateKey: privateKey.slice(2), // remove `0x` prefix
        });
    }

    return boostedAddresses;
}

const calculateContractAddress = (sender: string, nonce: number): string => {
    const encoded = encode([sender, nonce]) as any;
    const nonceHash = web3.utils.sha3(encoded);

    return web3.utils.toChecksumAddress(`0x${nonceHash.substring(26)}`);
}

const assertDeployAddresses = (deploys: { name: string, instance: { address: string }, target: string }[]) => {
    for (const { instance: expected, target: actual, name } of deploys) {
        if (expected.address !== actual) {
            throw new Error(`${name}: ${expected.address} !== ${actual}`)
        }
    }
}

export const expectZeroBalance = (actual: any): void => {
    ((expect(actual).to.be) as any).bignumber.equal(ZERO);
}

export const expectBigNumber = (actual: any, expected: any): void => {
    ((expect(actual).to.be) as any).bignumber.equal(expected);
}

export const expectBigNumberApprox = (actual: any, expected: any, epsilon?): void => {
    epsilon = epsilon ?? ether("1").div(new BN(1_000_000));

    // This is for comparing small differences due to e.g. minted DUBI that just amounts
    // to some dust. (i.e. <= 0.00001 DUBI)
    const diff = actual.sub(expected).abs();
    const isLessThanEqual = diff.lte(epsilon);
    if (!isLessThanEqual) {
        console.log(`${actual} ${expected} ${diff}`);
    }

    expect(isLessThanEqual).to.be.true;
}

// Misc

export const createOrderPairHash = (makerContractAddress: string, takerContractAddress: string, makerCurrencyType: number, takerCurrencyType: number): string => {
    const encoded = web3.eth.abi.encodeParameters(
        ["address", "address", "uint8", "uint8"],
        [makerContractAddress, takerContractAddress, makerCurrencyType, takerCurrencyType],
    );

    return Web3.utils.sha3(encoded);
}


export const toNumberHex = (input: number): string => `0x${input.toString(16).padStart(64, "0")}`;
export const toStringHex = (input: string): string => `0x${Buffer.from(input).toString("hex").padEnd(64, "0")}`;

export const mockHeroAttributes = (attributes?: Record<string, any>): { keys: string[], values: (string | number)[] } => mockAttributes({ ...heroAttributes, ...attributes });
export const mockPetAttributes = (attributes?: Record<string, any>): { keys: string[], values: (string | number)[] } => mockAttributes({ ...petAttributes, ...attributes });

export const mockAttributes = (attributes?: {}): { keys: string[], values: (string | number)[] } => {
    const keys: string[] = [];
    const values: string[] = [];
    for (const [key, value] of Object.entries({ ...defaultAttributes, ...attributes })) {
        keys.push(toStringHex(key));
        values.push(typeof value === "string" ? toStringHex(value) : toNumberHex(value))
    }

    return {
        keys,
        values,
    }
}

export const defaultAttributes = {
    level: 1,
    stars: 1,
    faction: 1,
    abilities: 1234,
    season: 1,
}

export const heroAttributes = {
    ...defaultAttributes,
    headId: "tmpTw-bobobobobobob",
    skinSlot: 1,
    skinDivision: 1,
    class: 1,
}

export const petAttributes = {
    ...defaultAttributes,
    headId: "1",
    shinyHue: 1,
    rarity: 1,
}