// *
// Vault constants
//

export enum CHAINID {
  ETH_MAINNET = 1, // eslint-disable-line no-unused-vars
  ETH_KOVAN = 42, // eslint-disable-line no-unused-vars
  AVAX_MAINNET = 43114, // eslint-disable-line no-unused-vars
  AVAX_FUJI = 43113, // eslint-disable-line no-unused-vars
  AURORA_MAINNET = 1313161554, // eslint-disable-line no-unused-vars
  AURORA_TESTNET = 1313161555, // eslint-disable-line no-unused-vars
}

/**
 * Chainlink Oracles
 *
 * https://data.chain.link/
 * https://docs.chain.link/docs/avalanche-price-feeds
 */

export const ETH_PRICE_ORACLE = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'

export const BTC_PRICE_ORACLE = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'

export const USDC_PRICE_ORACLE = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'

/**
 * Gamma Protocol
 */
export const ON_TOKEN_FACTORY = '0x17c8ad9758B3dc5523b4E7Cb8A11AFF8f48E7A80'

export const MARGIN_POOL = '0xdFB0B57f27Bc62a262A3deb8AE12f89eADC10C2e'

export const GAMMA_CONTROLLER = '0x61f48E66ddC004EaA7E322868Ff23234e466be84'

export const ORACLE_DISPUTE_PERIOD = 7200
export const ORACLE_LOCKING_PERIOD = 300

/**
 * DEX Routers and Factories
 */
export const DEX_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' // Uniswap V2 Router

/**
 * Gamma Pricers
 */
export const CHAINLINK_WETH_PRICER = '0xAC05f5147566Cc949b73F0A776944E7011FabC50'

export const CHAINLINK_WETH_PRICER_NEW = '0x128cE9B4D97A6550905dE7d9Abc2b8C747b0996C' // New ChainLink

/**
 * Gnosis Protocol
 */
export const GNOSIS_EASY_AUCTION = '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101'
