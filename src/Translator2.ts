import { AlchemyProvider, JsonRpcProvider } from '@ethersproject/providers'
import abiDecoder from 'abi-decoder'
import { Augmenter } from 'core/Augmenter'
import RawDataFetcher from 'core/RawDataFetcher'
import { transformDecodedData, transformDecodedLogs } from 'core/transformDecodedLogs'
import {
    Address,
    Chain,
    ContractData,
    ContractType,
    Decoded,
    DecodedCallData,
    Interaction,
    Interpretation,
    RawDecodedLog,
    RawTxData,
    RawTxDataWithoutTrace,
} from 'interfaces'
import { ABI_Item, ABI_ItemUnfiltered } from 'interfaces/abi'
import { EVMTransaction } from 'interfaces/s3'
import traverse from 'traverse'
import { filterABIs, getChainBySymbol, getKeys, isAddress, validateAndNormalizeAddress } from 'utils'
import Etherscan from 'utils/clients/Etherscan'

export type TranslatorConfigTwo = {
    chain: Chain
    nodeUrl?: string
    alchemyProjectId: string
    etherscanAPIKey: string
    userAddress?: string
}

export type NamesAndSymbolsMap = Record<Address, { name: string | null; symbol: string | null }>

// const defaultConfig: TranslatorConfigTwo = {
//     chain: getChainBySymbol('ETH'),
// }

class Translator2 {
    nodeUrl: string | null
    alchemyProjectId: string
    chain: Chain
    etherscanAPIKey: string
    provider: AlchemyProvider
    rawDataFetcher: RawDataFetcher
    etherscan: Etherscan
    userAddress: Address | null
    augmenter: Augmenter

    constructor(config: TranslatorConfigTwo) {
        this.chain = config.chain
        this.nodeUrl = config.nodeUrl || null
        this.alchemyProjectId = config.alchemyProjectId
        this.etherscanAPIKey = config.etherscanAPIKey
        this.userAddress = config.userAddress ? validateAndNormalizeAddress(config.userAddress) : null
        this.provider = this.getProvider()
        this.etherscan = new Etherscan(this.etherscanAPIKey)
        this.rawDataFetcher = new RawDataFetcher(this.provider)
        this.augmenter = new Augmenter(this.provider, null, this.etherscan)
    }

    private getProvider(): AlchemyProvider {
        if (this.nodeUrl) {
            throw new Error(
                'the node url option (JsonRpcProvider instead of AlchemyProvider) Not implemented. RawDataFetcher uses AlchemyProvider b/c defaultProvider was throwing errors, and using just Alchemy wasnt throwing errors',
            )
            // return new JsonRpcProvider(this.nodeUrl, this.chain.id)
        }
        if (this.alchemyProjectId) {
            return new AlchemyProvider(this.chain.id, this.alchemyProjectId)
        } else {
            throw new Error('No node url or alchemy project id provided')
        }
    }

    /**********************************************/
    /**** FROM WALLET ADDRESS OR TX HASH ONLY *****/
    /**********************************************/
    updateUserAddress(userAddress: string) {
        this.userAddress = validateAndNormalizeAddress(userAddress)
    }

    // Gets the txResponse, txReceipt, txTrace from a node. Archive node needed
    async getRawTxData(txHash: string): Promise<RawTxData> {
        return this.rawDataFetcher.getTxData(txHash)
    }

    async getRawTxDataWithoutTrace(txHash: string): Promise<RawTxDataWithoutTrace> {
        return this.rawDataFetcher.getTxDataWithoutTrace(txHash)
    }

    getRawDataFromS3Data(tx: EVMTransaction, timestamp: number): RawTxDataWithoutTrace {
        return this.rawDataFetcher.getTxDataFromS3Tx(tx, timestamp)
    }

    // Could rely on Etherscan, but they have a max of 10k records
    // async getAllTxHashesForAddress(address: string): Promise<string[]> {
    //     throw new Error('Not implemented')
    // }

    getContractAddressesFromRawTxData(rawTxData: RawTxData | RawTxDataWithoutTrace): Address[] {
        const { txReceipt } = rawTxData
        const addresses: Address[] = []
        addresses.push(validateAndNormalizeAddress(txReceipt.to))

        txReceipt.logs.forEach(({ address }) => {
            addresses.push(validateAndNormalizeAddress(address))
        })

        return [...new Set(addresses)]
    }

    getAllAddresses(
        decodedLogs: Interaction[],
        decodedCallData: DecodedCallData,
        contractAddresses: Address[],
    ): Address[] {
        const addresses: Address[] = []

        traverse(decodedLogs).forEach(function (value: string) {
            if (isAddress(value)) {
                addresses.push(validateAndNormalizeAddress(value))
            }
        })

        traverse(decodedCallData).forEach(function (value: string) {
            if (isAddress(value)) {
                addresses.push(validateAndNormalizeAddress(value))
            }
        })

        return [...new Set([...addresses, ...contractAddresses])]
    }

    /**********************************************/
    /**** USING TX AND CONTRACT ADDRESSES  ********/
    /****  Data used to decode & augment   ********/
    /**********************************************/
    async getABIsForContracts(contractAddresses: string[]): Promise<Record<Address, ABI_ItemUnfiltered[]>> {
        const addresses = contractAddresses.map((a) => validateAndNormalizeAddress(a))
        const abiMap = await this.etherscan.getABIs(addresses)

        return abiMap
    }

    // TODO get the names
    async getABIsAndNamesForContracts(
        contractAddresses: string[],
    ): Promise<[Record<Address, ABI_ItemUnfiltered[]>, Record<Address, string | null>]> {
        const addresses = contractAddresses.map((a) => validateAndNormalizeAddress(a))
        const abiMap = await this.etherscan.getABIs(addresses)

        const nameMap: Record<Address, string | null> = {}

        getKeys(abiMap).forEach((address) => {
            nameMap[address] = null
        })

        return [abiMap, nameMap]
    }

    async getNameAndSymbol(
        address: string,
        contractType: ContractType,
    ): Promise<{ tokenName: string | null; tokenSymbol: string | null; contractName: string | null }> {
        return this.augmenter.getNameAndSymbol(address, contractType)
    }

    async getNamesAndSymbols(contractAddresses: string[]): Promise<NamesAndSymbolsMap> {
        throw new Error('Not implemented')
    }

    async getENSNames(addresses: Address[]): Promise<Record<Address, string>> {
        return this.augmenter.getENSNames(addresses)
    }

    async getOfficialNamesForContracts(contractAddresses: string[]): Promise<Record<Address, string>> {
        throw new Error('Not implemented')
    }

    async getContractName(address: string): Promise<string | null> {
        throw new Error('Not implemented')
    }

    async getContractsData(
        contractToAbiMap: Record<Address, ABI_ItemUnfiltered[]>,
        contractToOfficialNameMap: Record<Address, string | null>,
    ): Promise<Record<Address, ContractData>> {
        return this.augmenter.getContractsData(contractToAbiMap, contractToOfficialNameMap)
    }

    // We should store this in a contracts table just so we can see this data more easily
    getContractType(address: Address, abi: ABI_Item[]): Promise<ContractType> {
        return this.augmenter.getContractType(address, abi)
    }

    getContractTypes(contractToAbiMap: Record<Address, ABI_Item[]>): Promise<Record<Address, ContractType>> {
        throw new Error('Not implemented')
    }
    /**********************************************/
    /******      DECODING / AUGMENTING     ********/
    /**********************************************/
    decodeTxData(
        rawTxData: RawTxData | RawTxDataWithoutTrace,
        ABIs: Record<Address, ABI_Item[]>,
        contractDataMap: Record<Address, ContractData>,
    ): { decodedLogs: Interaction[]; decodedCallData: DecodedCallData } {
        const allABIs = []
        for (const abis of Object.values(ABIs)) {
            allABIs.push(...abis)
        }
        abiDecoder.addABI(allABIs)

        const { txReceipt } = rawTxData
        const { logs } = txReceipt

        // TODO logs that don't get decoded dont show up as 'null' or 'undefined', which will throw off mapping the logIndex to the decoded log

        const rawDecodedLogs = abiDecoder.decodeLogs(rawTxData.txReceipt.logs)
        const rawDecodedCallData = abiDecoder.decodeMethod(rawTxData.txResponse.data)

        const augmentedDecodedLogs = rawDecodedLogs.map((log, index) => {
            const decodedLog = {
                ...log,
                logIndex: logs[index].logIndex,
                address: validateAndNormalizeAddress(log.address),
            }
            return decodedLog
        }) as RawDecodedLog[]

        const decodedLogs = transformDecodedLogs(rawTxData.txReceipt.logs, augmentedDecodedLogs, contractDataMap)
        const decodedCallData = transformDecodedData(rawDecodedCallData)

        return { decodedLogs, decodedCallData }
    }

    decodeTxDataArr(rawTxDataArr: RawTxData[], ABIs: Record<Address, ABI_Item[]>[]): Decoded[] {
        throw new Error('Not implemented')
    }

    augmentDecodedData(
        decodedLogs: Interaction[],
        decodedCallData: DecodedCallData,
        ensMap: Record<Address, string>,
        contractDataMap: Record<Address, ContractData>,
        rawTxData: RawTxData | RawTxDataWithoutTrace,
    ): Decoded {
        return this.augmenter.augmentDecodedData(decodedLogs, decodedCallData, ensMap, contractDataMap, rawTxData)
    }

    //This is a subset of augmentDecodedData
    // addEnsToDecodedData(decoded: Decoded, ens: Record<Address, string>): Decoded {
    //     throw new Error('Not implemented')
    // }

    /**********************************************/
    /******          INTERPRETING          ********/
    /**********************************************/

    interpretDecodedTx(decoded: Decoded, userAddress: Address | null = null): Interpretation {
        throw new Error('Not implemented')
    }

    // If we do this after we've created the example description, we'll have to figure out how to parse any addresses we've turned into a shorter name or onoma name
    // addEnsToInterpretedData(ens: Record<Address, string>): Interpretation {
    //     throw new Error('Not implemented')
    // }

    async interpretTx(txHash: string, userAddress: Address | null = null): Promise<Interpretation> {
        const rawTxData = await this.getRawTxData(txHash)
        const addresses = this.getContractAddressesFromRawTxData(rawTxData)
        const [unfilteredAbiMap, officialContractNamesMap] = await this.getABIsAndNamesForContracts(addresses)
        const AbiMap = filterABIs(unfilteredAbiMap)
        const ensMap = await this.getENSNames(addresses)
        const contractDataMap = await this.getContractsData(AbiMap, officialContractNamesMap)

        const { decodedLogs, decodedCallData } = this.decodeTxData(rawTxData, AbiMap, contractDataMap)
        const decodedWithAugmentation = this.augmentDecodedData(
            decodedLogs,
            decodedCallData,
            ensMap,
            contractDataMap,
            rawTxData,
        )

        const interpretation = this.interpretDecodedTx(decodedWithAugmentation, userAddress)

        return interpretation
    }
}

export default Translator2
