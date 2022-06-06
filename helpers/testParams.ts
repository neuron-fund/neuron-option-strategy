import { BigNumber } from 'ethers'
import { CHAINLINK_WETH_PRICER_NEW, CHAINLINK_WETH_PRICER, CHAINID } from '../constants/constants'
import { WETH, USDC, DAI, USDT, CURVE_3CRV_POOL, CURVE_3CRV_LP_TOKEN } from '../constants/externalAddresses'
import { getDeltaStep } from './utils'
import { VaultTestParams } from './vault'

export const NeuronEthThetaVaultPutTestParams: VaultTestParams = {
  name: `Neuron ETH Theta Vault (Put)`,
  tokenName: 'Neuron ETH Theta Vault',
  tokenSymbol: 'nETH-THETA',
  underlying: WETH,
  strikeAsset: USDC,
  neuronPoolsNames: ['NeuronPoolCurve3pool', 'NeuronPoolCurveFrax'],
  neuronPoolsPricersNames: ['NeuronPoolCurve3poolPricer', 'NeuronPoolCurveFraxPricer'],
  additionalPricersNames: [
    {
      pricerName: 'CRV3Pricer',
      asset: CURVE_3CRV_LP_TOKEN,
    },
  ],
  chainlinkPricer: CHAINLINK_WETH_PRICER_NEW[CHAINID.ETH_MAINNET],
  underlyingPricer: CHAINLINK_WETH_PRICER[CHAINID.ETH_MAINNET],
  deltaFirstOption: BigNumber.from('1000'),
  deltaSecondOption: BigNumber.from('1000'),
  deltaStep: getDeltaStep('WETH'),
  depositAmount: BigNumber.from('100000000000'),
  minimumSupply: BigNumber.from('10').pow('3').toString(),
  expectedMintAmount: BigNumber.from('4761904761'),
  premiumDiscount: BigNumber.from('997'),
  managementFee: BigNumber.from('2000000'),
  performanceFee: BigNumber.from('20000000'),
  auctionDuration: 21600,
  tokenDecimals: 18,
  isPut: false,
  auctionBiddingToken: USDC,
}

export const testsParams: VaultTestParams[] = [NeuronEthThetaVaultPutTestParams]
