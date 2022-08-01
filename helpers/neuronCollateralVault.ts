import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'
import { deployments } from 'hardhat'
import { USDC, WETH } from '../constants/externalAddresses'
import {
  NeuronCollateralVault,
  INeuronPool,
  INeuronPool__factory,
  INeuronPoolPricer__factory,
} from '../typechain-types'
import { assert } from './assertions'
import { depositToNeuronPool, prepareNeuronPool } from './neuronPool'
import { deployProxy, setAssetPricer } from './utils'

export async function depositIntoCollateralVault(
  collateralVault: NeuronCollateralVault,
  neuronPool: INeuronPool,
  amount: BigNumber,
  signer: SignerWithAddress
) {
  const depositAmount = amount
  await depositToNeuronPool(neuronPool, signer, depositAmount)
  const collateralBalanceStarted = await neuronPool.connect(signer).balanceOf(signer.address)
  const neuronPoolPricePerShare = await neuronPool.connect(signer).pricePerShare()
  const withdrawAmount = neuronPoolPricePerShare.mul(collateralBalanceStarted).div(BigNumber.from(10).pow(18))
  assert.bnEqual(withdrawAmount, depositAmount, 'Collateral withdraw amount is not equal to deposit amount')
  await neuronPool.connect(signer).approve(collateralVault.address, collateralBalanceStarted)
  const tx = await collateralVault.connect(signer).deposit(collateralBalanceStarted, neuronPool.address)

  return { collateralAmountDeposited: collateralBalanceStarted, tx }
}

export async function deployNeuronCollateralVault({
  neuronPoolName,
  ownerSigner,
  owner,
  keeper,
  keeperSigner,
  feeRecipient,
  managementFee,
  performanceFee,
  tokenName,
  tokenSymbol,
  isPut,
  tokenDecimals,
  underlying,
  minimumSupply,
  neuronPoolPricerName,
  adminSigner,
  collateralVaultCap,
  collateralVaultLifecycleLib,
  neuronPoolUtilsLib,
}) {
  const collateralVaultDeployArgs = [USDC]
  const neuronPoolDeployment = await deployments.get(neuronPoolName)
  const neuronPool = INeuronPool__factory.connect(neuronPoolDeployment.address, ownerSigner)
  await prepareNeuronPool(neuronPool)
  const neuronPoolAddress = neuronPool.address

  const neuronPoolPricerDeployment = await deployments.get(neuronPoolPricerName)

  const neuronPoolPricer = INeuronPoolPricer__factory.connect(neuronPoolPricerDeployment.address, ownerSigner)

  await setAssetPricer(neuronPoolAddress, neuronPoolPricer.address)

  const collateralUnwrappedAsset = await neuronPool.token()
  const neuronPoolSupportedTokens = await neuronPool.getSupportedTokens()

  const collateralVaultInitializeArgs = [
    owner,
    keeper,
    feeRecipient,
    managementFee,
    performanceFee,
    `COLLATERAL-${tokenName}`,
    `CV${tokenSymbol}`,
    [isPut, tokenDecimals, neuronPoolAddress, underlying, minimumSupply, collateralVaultCap],
    neuronPoolSupportedTokens,
  ]
  const collateralVault = (
    await deployProxy('NeuronCollateralVault', adminSigner, collateralVaultInitializeArgs, collateralVaultDeployArgs, {
      libraries: {
        CollateralVaultLifecycle: collateralVaultLifecycleLib.address,
        NeuronPoolUtils: neuronPoolUtilsLib.address,
      },
    })
  ).connect(keeperSigner) as NeuronCollateralVault

  return {
    collateralVault,
    collateralUnwrappedAsset,
    neuronPoolSupportedTokens,
    neuronPoolPricer,
    neuronPoolAddress,
    neuronPool,
  }
}
