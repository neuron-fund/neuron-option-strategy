import { ethers, network } from 'hardhat'
import { BigNumber } from '@ethersproject/bignumber'
import { CRV_CVX_ETH, DAI, LIDO_ST_ETH, USDC, USDT, WBTC, WETH } from '../../constants/externalAddresses'
import { CHAINID } from '../../constants/constants'

export const whalesMainnet = {
  [WBTC]: '0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE',
  [WETH]: '0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE',
  [USDC]: '0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE',
  [DAI]: '0x5a16552f59ea34e44ec81e58b3817833e9fd5436',
  [USDT]: '0x5754284f345afc66a98fbb0a0afe71e0f007b949',
  [CRV_CVX_ETH]: '0x38ee5f5a39c01cb43473992c12936ba1219711ab',
  [LIDO_ST_ETH]: '0x06920c9fc643de77b99cb7670a944ad31eaaa260',
} as const

export const whales = {
  [CHAINID.ETH_MAINNET]: whalesMainnet,
}

export type AseetsWithWhales = keyof typeof whalesMainnet

export const getAsset = async (chainId: number, asset: string, amount: BigNumber, recipient: string) => {
  const whaleAddress = whales[chainId][asset]
  if (!whaleAddress) {
    throw new Error(`whale for ${asset} is not defined`)
  }
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [whaleAddress],
  })
  const whale = await ethers.getSigner(whaleAddress)
  const assetContract = await ethers.getContractAt('IERC20', asset)
  const balance = await assetContract.connect(whale).balanceOf(whaleAddress)
  await assetContract.connect(whale).transfer(recipient, amount)
  await network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [whaleAddress],
  })
}
