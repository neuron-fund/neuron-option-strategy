import { ethers, network } from 'hardhat'
import { BigNumber } from '@ethersproject/bignumber'
import {
  ALUSD,
  ALUSD3CRV,
  CRV_CVX_ETH,
  DAI,
  FRAX3CRV,
  LIDO_ST_ETH,
  LUSD3CRV,
  MIM3CRV,
  MIMUST,
  USDC,
  USDP3CRV,
  USDT,
  WBTC,
  WETH,
} from '../constants/externalAddresses'
import { CHAINID } from '../constants/constants'

export const whalesMainnet = {
  [WBTC]: '0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE',
  [WETH]: '0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE',
  [USDC]: '0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE',
  [DAI]: '0x5a16552f59ea34e44ec81e58b3817833e9fd5436',
  [USDT]: '0x5754284f345afc66a98fbb0a0afe71e0f007b949',
  [CRV_CVX_ETH]: '0x38ee5f5a39c01cb43473992c12936ba1219711ab',
  [LIDO_ST_ETH]: '0x06920c9fc643de77b99cb7670a944ad31eaaa260',
  [FRAX3CRV]: '0x47bc10781e8f71c0e7cf97b0a5a88f4cfff21309',
  [LUSD3CRV]: '0xc64844d9b3db280a6e46c1431e2229cd62dd2d69',
  [ALUSD3CRV]: '0x613d9871c25721e8f90acf8cc4341bb145f29c23',
  [ALUSD]: '0x50acc1281845be0ac6936b4d7ad6a14ae613c1c9',
  [USDP3CRV]: '0x44bc6e3a8384979df6673ac81066c67c83d6d6b2',
  [MIMUST]: '0xcd468d6421a6c5109d6c29698548b2af46a5e21b',
  [MIM3CRV]: '0xe896e539e557bc751860a7763c8dd589af1698ce',
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
