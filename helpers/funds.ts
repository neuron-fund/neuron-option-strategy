import { ethers, network } from 'hardhat'
import { BigNumber } from '@ethersproject/bignumber'
import {
  ALUSD,
  ALUSD3CRV,
  CRV_CVX_ETH,
  CURVE_3CRV_LP_TOKEN,
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
  STE_CRV,
  CURVE_ALETH_LP_TOKEN,
  LUSD,
} from '../constants/externalAddresses'
import { parseEther } from '@ethersproject/units'
import { IERC20__factory } from '../typechain-types'

export const whales = {
  [WBTC]: '0xe3dd3914ab28bb552d41b8dfe607355de4c37a51',
  [WETH]: '0x1C11BA15939E1C16eC7ca1678dF6160Ea2063Bc5',
  [USDC]: '0x0D2703ac846c26d5B6Bbddf1FD6027204F409785',
  [DAI]: '0x5a16552f59ea34e44ec81e58b3817833e9fd5436',
  [USDT]: '0x5754284f345afc66a98fbb0a0afe71e0f007b949',
  [CRV_CVX_ETH]: '0x38ee5f5a39c01cb43473992c12936ba1219711ab',
  [LIDO_ST_ETH]: '0x06920c9fc643de77b99cb7670a944ad31eaaa260',
  [FRAX3CRV]: '0x605B5F6549538a94Bd2653d1EE67612a47039da0',
  [LUSD3CRV]: '0xc64844d9b3db280a6e46c1431e2229cd62dd2d69',
  [ALUSD3CRV]: '0x613d9871c25721e8f90acf8cc4341bb145f29c23',
  [ALUSD]: '0x50acc1281845be0ac6936b4d7ad6a14ae613c1c9',
  [USDP3CRV]: '0x44bc6e3a8384979df6673ac81066c67c83d6d6b2',
  [MIMUST]: '0xcd468d6421a6c5109d6c29698548b2af46a5e21b',
  [MIM3CRV]: '0xe896e539e557bc751860a7763c8dd589af1698ce',
  [CURVE_3CRV_LP_TOKEN]: '0xdD050C0950Cb996230519f928680ea3D7537eCA7',
  [STE_CRV]: '0x43378368D84D4bA00D1C8E97EC2E6016A82fC062',
  [CURVE_ALETH_LP_TOKEN]: '0x084d0cd0605f47D92Dc2DFD22238e9c5605023E9',
  [LUSD]: '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296',
} as const

export type AseetsWithWhales = keyof typeof whales

export const getAsset = async (asset: string, amount: BigNumber, recipient: string) => {
  const whaleAddress = whales[asset]
  if (!whaleAddress) {
    throw new Error(`whale for ${asset} is not defined`)
  }
  const localSigner = (await ethers.getSigners())[0]
  await localSigner.sendTransaction({
    to: whaleAddress,
    value: parseEther('0.5'),
  })
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [whaleAddress],
  })
  const whale = await ethers.getSigner(whaleAddress)
  const assetContract = await IERC20__factory.connect(asset, whale)
  const whaleBalance = await assetContract.connect(whale).balanceOf(whale.address)
  if (whaleBalance.lt(amount)) {
    throw Error(`Whale balance of ${asset} is less than ${amount}`)
  }
  await assetContract.connect(whale).transfer(recipient, amount)
  await network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [whaleAddress],
  })
}
