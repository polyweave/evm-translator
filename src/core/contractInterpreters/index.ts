const contractInterpreters = {
    '0xd569d3cce55b71a8a3f3c418c329a66e5f714431': require('./TerminalV1_0xd569.json'),
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': require('./UniswapV2Router02_0x7a25.json'),
    '0x7f268357a8c2552623316e2562d90e642bb538e5': require('./WyvernExchangeWithBulkCancellations_0x7f26.json'),
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45': require('./SwapRouter02_0x68b3.json'), //Uniswap v3 router 2
    '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f': require('./SushiswapRouter_0xd9e1.json'),
}

export default contractInterpreters
