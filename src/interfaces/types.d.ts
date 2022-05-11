declare module 'eth-ens-namehash' {
    type Address = `0x${string}`
    function normalize(name: string): string
    function hash(name: string): Address
}

declare module 'abi-decoder' {
    function addABI(abi: any[]): void
    function decodeLogs(logs: any[]): Omit<import('core/transformDecodedLogs').RawDecodedLog[], 'logIndex'>
    function decodeMethod(data: string): import('core/transformDecodedLogs').RawDecodedCallData
}
