import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'
import { CHAINID } from '../constants/constants'
import { NeuronCollateralVault, INeuronPool } from '../typechain-types'
import { assert } from './assertions'
import { depositToNeuronPool } from './neuronPool'

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
