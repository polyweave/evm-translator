import { Action, Address, Decoded, InteractionEvent, Interpretation, Token } from 'interfaces'
import { blackholeAddress } from 'utils/constants'

function isMintEvent(event: any, userAddress: Address) {
    return event.event === 'Transfer' && event.from === blackholeAddress && event.to === userAddress
}

function isSendEvent(event: any, userAddress: Address) {
    return event.event === 'Transfer' && event.from === userAddress
}

function isReceiveEvent(event: any, userAddress: Address) {
    return event.event === 'Transfer' && event.to === userAddress
}

function getAction(events: InteractionEvent[], userAddress: Address): Action {
    const isMint = events.find((e) => isMintEvent(e, userAddress))
    const isSend = events.find((e) => isSendEvent(e, userAddress))
    const isReceive = events.find((e) => isReceiveEvent(e, userAddress))

    if (isMint) {
        return 'minted'
    } else if (isSend) {
        return 'sent'
    } else if (isReceive) {
        return 'received'
    }

    return '______TODO______'
}

function getTokenInfo(interpretation: Interpretation, action: Action): Token {
    switch (action) {
        case 'minted':
        case 'received':
            console.log(interpretation.tokensReceived[0])
            return interpretation.tokensReceived[0]
        case 'sent':
        default:
            console.log(interpretation.tokensSent[0])
            return interpretation.tokensSent[0]
    }
}

function interpretGenericERC721(decodedData: Decoded, interpretation: Interpretation, userAddress: Address) {
    let exampleDescription = '______TODO______'
    let counterpartyNames: string[] = []

    const tokenContractInteraction = decodedData.interactions.find(
        (interaction) => interaction.contractAddress === decodedData.toAddress,
    )
    const tokenEvents = tokenContractInteraction?.events || []

    const action = getAction(tokenEvents, userAddress)

    console.log(interpretation)

    const { name, symbol, tokenId } = getTokenInfo(interpretation, action)
    let tokenCount = 0

    if (action === 'minted') {
        tokenCount = interpretation.tokensReceived.length

        if (tokenCount > 1) {
            exampleDescription = `${interpretation.userName} ${action} ${tokenCount} ${symbol || '???'} from ${name}`
        } else {
            exampleDescription = `${interpretation.userName} ${action} ${symbol || '???'}s of #${tokenId} from ${name}`
        }
    }
    if (action === 'received') {
        tokenCount = interpretation.tokensReceived.length
        const userName = tokenEvents
            .filter((e) => isReceiveEvent(e, userAddress))
            .map((e) => e.toENS || (e.to as string))[0]

        interpretation.userName = userName

        counterpartyNames = tokenEvents
            .filter((e) => isReceiveEvent(e, userAddress))
            .map((e) => e.fromENS || (e.from as string))

        if (tokenCount > 1) {
            exampleDescription = `${interpretation.userName}  ${action} ${tokenCount} ${
                symbol || '???'
            }  #${tokenId} from ${counterpartyNames[0]}`
        } else {
            exampleDescription = `${userName}  ${action} ${symbol || '???'} #${tokenId} from ${counterpartyNames[0]}`
        }
    }

    if (action === 'sent') {
        tokenCount = interpretation.tokensSent.length
        counterpartyNames = tokenEvents
            .filter((e) => isSendEvent(e, userAddress))
            .map((e) => e.toENS || (e.to as string))

        if (tokenCount > 1) {
            exampleDescription = `${interpretation.userName}  ${action} ${tokenCount} ${
                symbol || '???'
            }  #${tokenId} to ${counterpartyNames[0]}`
        } else {
            exampleDescription = `${interpretation.userName}  ${action} ${symbol || '???'}  #${tokenId} to ${
                counterpartyNames[0]
            }`
        }
    }

    interpretation.action = action
    interpretation.exampleDescription = exampleDescription
    interpretation.extra = {}

    if (counterpartyNames.length > 0) {
        interpretation.extra.counterpartyNames = counterpartyNames
    }
    if (counterpartyNames.length === 1) {
        interpretation.extra.counterpartyName = counterpartyNames[0]
    }
}

export default interpretGenericERC721
