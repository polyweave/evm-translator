import { transformCovalentEvents } from './transformCovalentLogs'
import { BaseProvider, Formatter } from '@ethersproject/providers'
import reverseRecords from 'ABIs/ReverseRecords.json'
// import { normalize } from 'eth-ens-namehash'
import { Contract } from 'ethers'
import { formatUnits } from 'ethers/lib/utils'
import { Address, ContractType, Decoded, InProgressActivity, RawTxData, TX_TYPE } from 'interfaces'
import { CovalentTxData } from 'interfaces/covalent'
import traverse from 'traverse'
import { isAddress } from 'utils'
import checkInterface from 'utils/checkInterface'
import Covalent from 'utils/clients/Covalent'
import Etherscan from 'utils/clients/Etherscan'
import fourByteDirectory from 'utils/clients/FourByteDirectory'
import { REVERSE_RECORDS_CONTRACT_ADDRESS } from 'utils/constants'
import getTypeFromABI from 'utils/getTypeFromABI'

export type DecoderConfig = {
    covalentData?: CovalentTxData
    useNodeForENS: boolean
    use4ByteDirectory: boolean
    useTinTin: boolean
}

export class Augmenter {
    provider: BaseProvider
    covalent: Covalent
    etherscan: Etherscan
    formatter = new Formatter()

    inProgressActivity!: InProgressActivity
    rawTxDataArr!: RawTxData[]
    decodedArr!: Decoded[]

    covalentData?: CovalentTxData
    covalentDataArr: CovalentTxData[] = []

    fnSigCache: Record<string, string> = {}
    ensCache: Record<Address, string> = {}

    constructor(provder: BaseProvider, covalent: Covalent, etherscan: Etherscan) {
        this.provider = provder
        this.covalent = covalent
        this.etherscan = etherscan
    }

    async decode(rawTxDataArr: RawTxData[], covalentTxDataArr: CovalentTxData[] = []): Promise<Decoded[]> {
        this.rawTxDataArr = rawTxDataArr
        this.covalentDataArr = covalentTxDataArr

        this.createDecodedArr()

        await this.decodeMethodNames()
        await this.getContractTypes()

        if (!this.covalentDataArr.length && this.rawTxDataArr.length) {
            await this.getCovalentData()
        }

        this.augmentTimestampWithCovalent()
        await this.augmentOfficialContractNames()
        this.augmentInteractionData()
        if (this.provider.network.chainId == 1) {
            // only mainnet
            await this.augmentENSnames()
        }

        return this.decodedArr
    }

    private createDecodedArr() {
        const formattedRawTxDataArr = this.rawTxDataArr.map((rawTxData) => {
            try {
                const { txReceipt, txResponse } = rawTxData
                const value = rawTxData.txResponse.value.toString()

                let txType: TX_TYPE
                if (!txReceipt.to) {
                    txType = TX_TYPE.CONTRACT_DEPLOY
                } else if (txResponse.data == '0x') {
                    txType = TX_TYPE.TRANSFER
                } else {
                    // TODO txReciept.contractAddress is the address of the contract created, add it
                    txType = TX_TYPE.CONTRACT_INTERACTION
                }

                const transformedData = {
                    txType: txType,
                    nativeTokenValueSent: value == '0' ? '0' : formatUnits(value),
                    txIndex: txReceipt.transactionIndex,
                    reverted: txReceipt.status == 0,
                    gasUsed: txReceipt.gasUsed.toString(),
                    effectiveGasPrice: txReceipt.effectiveGasPrice?.toString() || txResponse?.gasPrice?.toString(),
                    fromAddress: txReceipt.from,
                    toAddress: txReceipt.to,
                    interactions: [],
                    contractType: ContractType.OTHER,
                }

                return transformedData
            } catch (e) {
                console.error('error in createDecodedArr', e)
                throw e
            }
        })

        this.decodedArr = formattedRawTxDataArr
    }

    private async getCovalentData(): Promise<void> {
        if (this.rawTxDataArr.length > 1) {
            throw new Error('Not implemented. This only happens if you already got raw data via Covalent')
        } else {
            const covalentResponse = await this.covalent.getTransactionFor(this.rawTxDataArr[0].txResponse.hash)
            const covalentData = covalentResponse.items[0]
            this.covalentDataArr.push(covalentData)
        }
    }

    private augmentOfficialContractNames() {
        // can get it from contract JSON, maybe ABI, and/or TinTin too
        if (this.covalentDataArr.length) {
            this.covalentDataArr.forEach((covalentData, index) => {
                this.decodedArr[index].officialContractName = covalentData.to_address_label || null
            })
        }
    }

    private augmentTimestampWithCovalent() {
        this.covalentDataArr.forEach((covalentData, index) => {
            this.decodedArr[index].timestamp = covalentData.block_signed_at
        })
    }
    private augmentInteractionData() {
        // we can get do this transformation with the ABI too. We can trust Covalent for now, but we already have a shim in there for ERC721s...
        if (this.covalentDataArr.length) {
            this.covalentDataArr.forEach((covalentData, index) => {
                this.decodedArr[index].interactions = transformCovalentEvents(covalentData)
            })
        }
    }

    private async augmentENSnames(): Promise<void> {
        const ReverseRecords = new Contract(REVERSE_RECORDS_CONTRACT_ADDRESS, reverseRecords.abi, this.provider)

        async function getNames(addresses: string[]): Promise<string[]> {
            const allDirtyNames = (await ReverseRecords.getNames(addresses)) as string[]
            // remove illegal chars
            const allNames = allDirtyNames.map((name) => {
                return name.replace(/([^\w\s+*:;,.()/\\]+)/gi, '¿')
            })
            return allNames
        }

        const allAddresses: string[] = []

        traverse(this.decodedArr).forEach(function (value: any) {
            if (isAddress(value)) {
                allAddresses.push(value)
            }
        })

        // filter out duplicates
        const addresses = [...new Set(allAddresses)]

        const names = await getNames(addresses)

        let addressToNameMap: Record<string, string> = {}

        addresses.forEach((address, index) => {
            addressToNameMap[address] = names[index]
        })

        // TODO handle arrays of addresses
        // "events":[
        //     :{
        //     "event":"SafeSetup"
        //     "logIndex":112
        //     "initiator":"0xa6b71e26c5e0845f74c812102ca7114b6a896ab2"
        //     "owners":[
        //     :"0x17a059b6b0c8af433032d554b0392995155452e6"
        //     :"0x13e2ed5724e9d6df54ed1ea5b4fa81310458c1d9"
        //     :"0x825728f78912b98adfb06380f1fcdcda76fd0f87"
        //     ]
        //     "threshold":"2"
        //     "initializer":"0x0000000000000000000000000000000000000000"
        //     "fallbackHandler":"0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4"
        //     }
        // ]

        // filter out addresses:names with no names (most of them lol)
        addressToNameMap = Object.fromEntries(Object.entries(addressToNameMap).filter(([, v]) => v != ''))

        // "normalize", whatever that means. ENS told me too. prob not needed after the regex
        // const validNames = allNames.filter((n: string) => normalize(n) === n)

        const decodedArrWithENS = traverse(this.decodedArr).map((thing) => {
            if (!!thing && typeof thing === 'object' && !Array.isArray(thing)) {
                for (const [key, val] of Object.entries(thing)) {
                    if (addressToNameMap[val as string]) {
                        if (key == 'toAddress') {
                            thing.toENS = addressToNameMap[val as string]
                        } else if (key == 'fromAddress') {
                            thing.fromENS = addressToNameMap[val as string]
                        } else {
                            thing[key + 'ENS'] = addressToNameMap[val as string]
                        }
                    }
                }
            }
        })

        this.decodedArr = decodedArrWithENS
    }

    private async decodeMethodName(rawTxData: RawTxData): Promise<string> {
        // first try to get if from the contract-specific interpreter, or ABI

        let contractMethod = null

        const hexSignature = rawTxData.txResponse.data.slice(0, 10)
        if (this.fnSigCache[hexSignature]) {
            contractMethod = this.fnSigCache[hexSignature]
        } else {
            contractMethod = await fourByteDirectory.getMethodSignature(hexSignature)
            this.fnSigCache[hexSignature] = contractMethod
        }

        return contractMethod
    }

    private async decodeMethodNames(): Promise<void> {
        const methodNames = await Promise.all(
            this.rawTxDataArr.map(async (rawTxData, index) => {
                let methodName = null
                if (this.decodedArr[index].txType !== TX_TYPE.TRANSFER) {
                    methodName = await this.decodeMethodName(rawTxData)
                }
                return methodName
            }),
        )

        methodNames.forEach((methodName, index) => {
            this.decodedArr[index].contractMethod = methodName
        })
    }

    private async getContractType(contractAddress: Address): Promise<ContractType> {
        let contractType = await checkInterface(contractAddress, this.provider)

        if (contractType === ContractType.OTHER) {
            contractType = await getTypeFromABI(contractAddress, this.etherscan)
        }
        return contractType
    }
    private async getContractTypes() {
        const contractTypes = await Promise.all(
            this.rawTxDataArr.map(async (rawTxData, index) => {
                let contractType = ContractType.OTHER
                if (this.decodedArr[index].txType == TX_TYPE.CONTRACT_INTERACTION) {
                    contractType = await this.getContractType(rawTxData.txReceipt.to)
                }
                //     else if (this.decodedArr[index].txType == TX_TYPE.CONTRACT_DEPLOY) {
                //         //TODO
                // }
                return contractType
            }),
        )

        contractTypes.forEach((contractType, index) => {
            this.decodedArr[index].contractType = contractType
        })
    }
}
