import { Address, ContractData, Decoded, Interpretation } from 'interfaces'
import { ABI_ItemUnfiltered, ABI_Row } from 'interfaces/abi'

abstract class DatabaseInterface {
    connectionString: string
    constructor(connectionString: string) {
        this.connectionString = connectionString
    }

    abstract getContractDataForContract(contractAddress: Address): Promise<ContractData | null>
    abstract getContractDataForManyContracts(contractAddresses: Address[]): Promise<Array<ContractData | null>>

    abstract addOrUpdateContractData(contractData: ContractData): Promise<void>
    abstract addOrUpdateManyContractData(contractDataArr: ContractData[]): Promise<void>
    /** Contracts often don't have their full ABI shared, but we can infer it using a signature table when we see a contract using that ABI */
    abstract AppendABIsToContractData(contractAddress: Address, abi: ABI_ItemUnfiltered[]): Promise<void>

    abstract addOrUpdateABI(abiArr: ABI_Row): Promise<void>
    abstract addOrUpdateABIs(abiArr: ABI_Row[]): Promise<void>

    /** Returns an array b/c there might be more than one full signature per hex signature. hex<-->hashable is 1:1*/
    abstract getABIsForHexSignature(hexSignature: string): Promise<ABI_Row[] | null>
    abstract addABIsForHexSignature(abiArr: ABI_Row[]): Promise<void>
    abstract addABIForHexSignature(abi: ABI_Row): Promise<void>

    abstract getDecodedData(txHash: string): Promise<Decoded>
    abstract getManyDecodedData(txHashes: string[]): Promise<Array<Decoded>>

    abstract addOrUpdateDecodedData(decodedData: Decoded): Promise<void>
    abstract addOrUpdateManyDecodedData(decodedDataArr: Decoded[]): Promise<void>

    abstract addOrUpdateInterpretedData(interpretedData: Interpretation): Promise<void>
    abstract addOrUpdateManyInterpretedData(interpretedDataArr: Interpretation[]): Promise<void>

    abstract getInterpretedData(txHash: string, userAddress: Address | null): Promise<Interpretation | null>
    abstract getManyInterpretedData(
        txHashes: string[],
        userAddress: Address | null,
    ): Promise<Array<Interpretation | null>>
    abstract getAllInterpretationsForTxHash(txHash: string): Promise<Interpretation[]>
    abstract getAllInterpretationsForAddress(address: Address): Promise<Interpretation[]>
}

export default DatabaseInterface
