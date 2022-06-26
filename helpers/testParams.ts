import { parseEther, parseUnits } from '@ethersproject/units'
import { BigNumber } from 'ethers'
import { CHAINLINK_WETH_PRICER_NEW, CHAINLINK_WETH_PRICER } from '../constants/constants'
import { WETH, USDC } from '../constants/externalAddresses'
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
  chainlinkPricer: CHAINLINK_WETH_PRICER_NEW,
  underlyingPricer: CHAINLINK_WETH_PRICER,
  deltaFirstOption: BigNumber.from('1000'),
  deltaSecondOption: BigNumber.from('1000'),
  deltaStep: getDeltaStep('WETH'),
  depositAmount: BigNumber.from(10).pow(18).mul(2000),
  minimumSupply: BigNumber.from(100).pow(3).toString(),
  premiumDiscount: BigNumber.from('997'),
  managementFee: BigNumber.from('2000000'),
  performanceFee: BigNumber.from('20000000'),
  auctionDuration: 21600,
  tokenDecimals: 18,
  isPut: true,
  auctionBiddingToken: USDC,
  collateralVaultCap: parseUnits('50000', 18),
}

export const NeuronEthThetaVaultCallTestParams: VaultTestParams = {
  name: `Neuron ETH Theta Vault (Call)`,
  tokenName: 'Neuron ETH Theta Vault',
  tokenSymbol: 'nETH-THETA',
  underlying: WETH,
  strikeAsset: USDC,
  neuronPoolsNames: ['NeuronPoolCurveSTETH', 'NeuronPoolCurveALETH'],
  neuronPoolsPricersNames: ['NeuronPoolCurveSTETHPricer', 'NeuronPoolCurveALETHPricer'],
  chainlinkPricer: CHAINLINK_WETH_PRICER_NEW,
  underlyingPricer: CHAINLINK_WETH_PRICER,
  deltaFirstOption: BigNumber.from('1000'),
  deltaSecondOption: BigNumber.from('1000'),
  deltaStep: getDeltaStep('WETH'),
  depositAmount: parseEther('1'),
  minimumSupply: BigNumber.from('10').pow('10').toString(),
  premiumDiscount: BigNumber.from('997'),
  managementFee: BigNumber.from('2000000'),
  performanceFee: BigNumber.from('20000000'),
  auctionDuration: 21600,
  tokenDecimals: 18,
  isPut: false,
  auctionBiddingToken: USDC,
  collateralVaultCap: parseUnits('50000', 18),
}

export const testsParams: VaultTestParams[] = [NeuronEthThetaVaultPutTestParams /* NeuronEthThetaVaultCallTestParams */]
