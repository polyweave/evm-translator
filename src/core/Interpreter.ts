/* eslint-disable @typescript-eslint/no-non-null-assertion */
import contractInterpreters from './contractInterpreters'
import contractDeployInterpreter from './genericInterpreters/ContractDeploy.json'
import lastFallback from './genericInterpreters/lastFallback'
import interpretGenericToken from './genericInterpreters/token'
import interpretGenericTransfer from './genericInterpreters/transfer'
import { BigNumber } from 'ethers'
import { formatEther } from 'ethers/lib/utils'
import {
    Action,
    Address,
    Chain,
    ContractType,
    Decoded,
    Interaction,
    InteractionEvent,
    Interpretation,
    Token,
    TokenType,
    TxType,
} from 'interfaces'
import { InterpreterMap } from 'interfaces/contractInterpreter'
import {
    fillDescriptionTemplate,
    getNativeTokenValueEvents,
    shortenNamesInString,
    validateAndNormalizeAddress,
} from 'utils'

function deepCopy<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj))
}

type ContractInterpretersMap = Record<Address, InterpreterMap>

type KeyMapping = {
    key: string
    defaultValue: string
    filters?: {
        event?: string
        to?: string
        from?: string
        value?: string
    } & Record<string, string>
    index?: number
    prefix?: string
    postfix?: string
    array?: boolean
}

function includes<T extends U, U>(collection: ReadonlyArray<T>, element: U): element is T {
    return collection.includes(element as T)
}

const topLevelInteractionKeys = ['contractName', 'contractSymbol', 'contractAddress'] as const

class Interpreter {
    contractSpecificInterpreters: ContractInterpretersMap = {}
    // fallbackInterpreters: Array<Inspector> = []
    userAddress: Address | null
    chain: Chain

    constructor(chain: Chain, userAddress: string | null = null) {
        this.chain = chain
        this.userAddress = (userAddress && validateAndNormalizeAddress(userAddress)) || null

        for (const [address, map] of Object.entries(contractInterpreters)) {
            this.contractSpecificInterpreters[address as Address] = map as InterpreterMap
        }
    }

    updateUserAddress(userAddress: string) {
        this.userAddress = validateAndNormalizeAddress(userAddress)
    }

    updateChain(chain: Chain) {
        this.chain = chain
    }

    public interpret(decodedDataArr: Decoded[]): Interpretation[] {
        const interpretations: Interpretation[] = []

        for (let i = 0; i < decodedDataArr.length; i++) {
            const decodedData = decodedDataArr[i]
            const interpretation = this.interpretSingleTx(decodedData)
            interpretations.push(interpretation)
        }

        return interpretations
    }

    public interpretSingleTx(decodedData: Decoded, userAddressFromInput: Address | null = null): Interpretation {
        const { contractMethod, interactions, fromAddress, toAddress } = decodedData

        const { nativeTokenValueSent, txHash } = decodedData

        const gasUsed = formatEther(
            BigNumber.from(decodedData.gasUsed).mul(BigNumber.from(decodedData.effectiveGasPrice)),
        )

        const userAddress = userAddressFromInput || this.userAddress || fromAddress

        let userName = userAddress.substring(0, 6)

        if (fromAddress === userAddress) {
            userName = decodedData.fromENS || userName
        }
        if (toAddress === userAddress) {
            userName = decodedData.toENS || userName
        }

        // TODO generalize this so it'll get any ENS (ex: _operatorENS)

        // not contract-specific
        const interpretation: Interpretation = {
            txHash,
            userAddress,
            action: Action.unknown,
            nativeTokenValueSent: this.getNativeTokenValueSent(
                interactions,
                nativeTokenValueSent,
                fromAddress,
                userAddress,
            ).toString(),
            nativeTokenValueReceived: this.getNativeTokenValueReceived(interactions, userAddress).toString(),
            tokensReceived: this.getTokensReceived(interactions, userAddress),
            tokensSent: this.getTokensSent(interactions, userAddress),
            nativeTokenSymbol: this.chain.symbol,
            userName,
            gasPaid: gasUsed,
            extra: {},
            exampleDescription: 'no example description defined',
            reverted: !!decodedData.reverted,
            contractName: null,
            counterpartyName: null,
        }

        if (interpretation.reverted) {
            interpretation.exampleDescription = 'transaction reverted'
            return interpretation
            // TODO the description and extras should be different for reverted transactions
        }

        const interpretationMapping = (toAddress && this.contractSpecificInterpreters[toAddress]) || null
        const methodSpecificMapping = (contractMethod && interpretationMapping?.writeFunctions[contractMethod]) || null

        // if there's no contract-specific mapping, try to use the fallback mapping

        if (decodedData.txType === TxType.CONTRACT_DEPLOY) {
            interpretation.action = Action.deployed
            interpretation.exampleDescription = contractDeployInterpreter.exampleDescription

            interpretation.extra = {
                ...interpretation.extra,
                ...this.useKeywordMap(interactions, contractDeployInterpreter.keywords, '0x_DOESNT_EXIST', userAddress),
            }

            interpretation.exampleDescription = fillDescriptionTemplate(
                contractDeployInterpreter.exampleDescriptionTemplate,
                interpretation,
            )
        } else if (decodedData.txType === TxType.TRANSFER) {
            interpretGenericTransfer(decodedData, interpretation)
            // contract-specific interpretation
        } else if (interpretationMapping && methodSpecificMapping && contractMethod && toAddress) {
            console.log('contract-specific interpretation', interpretationMapping.contractName, contractMethod)
            // some of these will be arbitrary keys
            interpretation.contractName = interpretationMapping.contractName
            interpretation.action = methodSpecificMapping.action
            interpretation.exampleDescription = methodSpecificMapping.exampleDescription

            if (decodedData.reverted) {
                interpretation.reverted = true
                // TODO the description and extras should be different for reverted transactions
            }
            interpretation.extra = this.useKeywordMap(
                interactions,
                methodSpecificMapping.keywords,
                toAddress,
                userAddress,
            )

            interpretation.exampleDescription = fillDescriptionTemplate(
                interpretationMapping.writeFunctions[contractMethod].exampleDescriptionTemplate,
                interpretation,
            )
        } else {
            if (decodedData.contractType !== ContractType.OTHER) {
                interpretGenericToken(decodedData, interpretation)
            } else {
                lastFallback(decodedData, interpretation)
            }
        }
        interpretation.exampleDescription = shortenNamesInString(interpretation.exampleDescription)
        return interpretation
    }
    getNativeTokenValueSent(
        interactions: Interaction[],
        nativeTokenValueSent: string | undefined,
        fromAddress: Address,
        userAddress: Address,
    ): number {
        if (fromAddress === userAddress) return Number(formatEther(nativeTokenValueSent || 0))

        const nativeTokenEvents = getNativeTokenValueEvents(interactions)
        const nativeTokenEventsReceived = nativeTokenEvents.filter((event) => event.params.from === userAddress)
        return nativeTokenEventsReceived.reduce((acc, event) => acc + Number(formatEther(event.params.value || 0)), 0)
    }
    getNativeTokenValueReceived(interactions: Interaction[], userAddress: string): number {
        const nativeTokenEvents = getNativeTokenValueEvents(interactions)
        const nativeTokenEventsReceived = nativeTokenEvents.filter((event) => event.params.to === userAddress)
        return nativeTokenEventsReceived.reduce((acc, event) => acc + Number(formatEther(event.params.value || 0)), 0)
    }

    private findValue(
        interactions: Interaction[],
        keyMapping: KeyMapping,
        userAddress: Address,
        contractAddress: Address,
    ): string | string[] {
        const filters = keyMapping.filters || {}
        const index = keyMapping.index || 0
        const array = keyMapping.array || false

        let filteredInteractions = deepCopy(interactions) as Interaction[]

        for (const [key, value] of Object.entries(filters)) {
            let valueToFind = value

            // special case for when we want to match on the contextualized user address
            if (value === '{userAddress}') valueToFind = userAddress
            if (value === '{contractAddress}') valueToFind = contractAddress

            // filter out by events that don't have the keys we want
            for (const interaction of filteredInteractions) {
                if (!includes(topLevelInteractionKeys, key)) {
                    interaction.events = interaction.events.filter(
                        (d) => d.params[key] === valueToFind || d.eventName === valueToFind,
                    )
                }
            }

            // if there aren't any events left, we don't want that interaction
            filteredInteractions = filteredInteractions.filter((i) => i.events.length > 0)

            // filter out interactions by top level key
            if (includes(topLevelInteractionKeys, key)) {
                filteredInteractions = filteredInteractions.filter((i) => i[key] === valueToFind)
            }
        }

        let value = null

        if (!array) {
            const interaction = filteredInteractions[index]
            const prefix = keyMapping.prefix || ''
            const str = (interaction as any)?.[keyMapping.key] || interaction?.events[index]?.params[keyMapping.key]
            const postfix = keyMapping.postfix || ''
            value = str ? prefix + str + postfix : keyMapping.defaultValue
        } else {
            value = []
            const prefix = keyMapping.prefix || ''
            const postfix = keyMapping.postfix || ''

            // I dont think anything but params will ever use this array feature, so we only support params here for now

            // if the key is in the interaction-level, just loop through those
            // if ((filteredInteractions[0] as any)?.[keyMapping.key]) {
            //     for (const interaction of filteredInteractions) {
            //         const str = (interaction as any)?.[keyMapping.key]
            //         const fullStr = str ? prefix + str + postfix : keyMapping.defaultValue
            //         value.push(fullStr)
            //     }
            // } else {
            for (const interaction of filteredInteractions) {
                for (const event of interaction.events) {
                    const str = event.params[keyMapping.key]
                    const fullStr = str ? prefix + str + postfix : keyMapping.defaultValue
                    value.push(fullStr)
                }
            }
            //}
        }

        return value
    }

    private getTokens(interactions: Interaction[], userAddress: Address, direction: 'to' | 'from'): Token[] {
        let tokens: Token[] = []
        type FlattenedInteraction = Omit<Interaction, 'events'> & InteractionEvent

        let filteredInteractions = deepCopy(interactions) as Interaction[]

        const toKeys = ['to', '_to']
        const fromKeys = ['from', '_from']
        const transferEvents = ['Transfer', 'TransferBatch', 'TransferSingle']

        for (const interaction of filteredInteractions) {
            // filter non-transfer events
            interaction.events = interaction.events.filter((d) => transferEvents.includes(d.eventName))
            // filter out events that aren't to/from the user in the right direction
            interaction.events = interaction.events.filter((d) => toOrFromUser(d, direction, userAddress))
        }

        // filter out interactions without any of the events we want
        filteredInteractions = filteredInteractions.filter(
            (i) =>
                i.events.filter(
                    (d) => transferEvents.includes(d.eventName), // filters out all non transfer events
                ).length > 0, // filters out interactions that don't have any events objects left
        )

        // console.log('filteredInteractions', filteredInteractions[0].events)
        const flattenedInteractions = flattenEvents(filteredInteractions)

        function getTokenType(interaction: FlattenedInteraction): TokenType {
            const LPTokenSymbols = ['UNI-V2']
            let tokenType = TokenType.DEFAULT

            // LP Token
            if (interaction.contractSymbol && LPTokenSymbols.includes(interaction.contractSymbol)) {
                tokenType = TokenType.LPToken
                // ERC-1155
            } else if (interaction.params._amount || interaction.params._amounts) {
                tokenType = TokenType.ERC1155
                // ERC-721
            } else if (interaction.params.tokenId) {
                tokenType = TokenType.ERC721
                // ERC-20
            } else if (Number(interaction.params.value) > 0) {
                tokenType = TokenType.ERC20
            }

            return tokenType
        }

        function toOrFromUser(event: InteractionEvent, direction: 'to' | 'from', userAddress: Address) {
            const directionArr = direction === 'to' ? toKeys : fromKeys
            return directionArr.filter((key) => event.params[key] === userAddress).length > 0
        }

        // each transfer event can have a token in it. for example, minting multiple NFTs
        function flattenEvents(interactions: Interaction[]) {
            const flattenedInteractions: FlattenedInteraction[] = []

            let flattenedInteraction: FlattenedInteraction
            for (const interaction of interactions) {
                const copiedInteraction = deepCopy(interaction) as any
                delete copiedInteraction.events
                flattenedInteraction = copiedInteraction

                for (const event of interaction.events) {
                    if (event.params._amounts) {
                        // ERC1155 you can batchTransfer multiple tokens, each w their own amount, in 1 event
                        for (const [index, amount] of event.params._amounts.entries()) {
                            let newInteraction = deepCopy(flattenedInteraction)
                            newInteraction.params._id = event.params._ids ? event.params._ids[index] : null
                            newInteraction.params._amount = amount
                            newInteraction = { ...newInteraction, ...event }
                            flattenedInteractions.push(newInteraction)
                        }
                    } else {
                        flattenedInteraction = { ...flattenedInteraction, ...event }
                        flattenedInteractions.push(flattenedInteraction)
                    }
                }
                // console.log('flattenedInteraction', flattenedInteraction)
            }

            return flattenedInteractions
        }

        tokens = flattenedInteractions.map((i) => {
            const tokenType = getTokenType(i)

            const amount = tokenType === TokenType.ERC1155 ? i.params._amount : i.params.value
            const tokenId = (tokenType === TokenType.ERC1155 ? i.params._id : i.params.tokenId)?.toString()

            const token: Token = {
                type: tokenType,
                name: i.contractName,
                symbol: i.contractSymbol,
                address: validateAndNormalizeAddress(i.contractAddress),
            }
            amount ? (token.amount = amount) : null
            tokenId ? (token.tokenId = tokenId) : null

            return token
        })

        return tokens
    }

    private getTokensReceived(interactions: Interaction[], userAddress: Address): Token[] {
        return this.getTokens(interactions, userAddress, 'to')
    }

    private getTokensSent(interactions: Interaction[], userAddress: Address): Token[] {
        return this.getTokens(interactions, userAddress, 'from')
    }

    private useKeywordMap(
        interactions: Interaction[],
        keywordsMap: Record<string, KeyMapping>,
        contractAddress: Address,
        userAddress: Address,
    ): Record<string, string | string[]> {
        const keyValueMap: Record<string, string | string[]> = {}

        const ignoreKeys = ['action', 'contractName', 'exampleDescription']

        for (const [key, value] of Object.entries(keywordsMap).filter(([key]) => !ignoreKeys.includes(key))) {
            // if the value is a string, we can just use it
            if (typeof value === 'string') {
                keyValueMap[key] = value

                // some data requires searching for it
            } else if (typeof value === 'object') {
                keyValueMap[key] = this.findValue(interactions, value, userAddress, contractAddress)

                if (Array.isArray(keyValueMap[key])) {
                    keyValueMap[`${key}Count`] = keyValueMap[key].length.toString()
                }
            }
        }

        return keyValueMap
    }
}

export default Interpreter
