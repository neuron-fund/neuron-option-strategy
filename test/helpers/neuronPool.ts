import { BigNumber } from '@ethersproject/bignumber'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract } from 'ethers'
import { ethers } from 'hardhat'
import { getAsset } from './funds'

/**
 * Deposits some assets to NeuronPool before tests so it has non-zero pricePerShare.
 */
export async function prepareNeuronPool(chainId: number, neuronPool: Contract) {
  const depositor = (await ethers.getSigners())[30]
  const assetAddress = await neuronPool.connect(depositor).asset()
  const assetContract = await ethers.getContractAt('IERC20Detailed', assetAddress)
  const assetDecimals = await assetContract.connect(depositor).decimals()
  const depositAmount = ethers.utils.parseUnits('100', assetDecimals)
  await getAsset(chainId, assetAddress, depositAmount, depositor.address)
  await assetContract.connect(depositor).approve(neuronPool.address, depositAmount)
  await neuronPool.connect(depositor).deposit(depositAmount)
}

export async function depositToNeuronPool(
  chainId: number,
  neuronPool: Contract,
  depositor: SignerWithAddress,
  amount: number | BigNumber
) {
  const assetAddress = await neuronPool.connect(depositor).asset()
  const assetContract = await ethers.getContractAt('IERC20Detailed', assetAddress)
  const assetDecimals = await assetContract.connect(depositor).decimals()
  const depositAmount = BigNumber.isBigNumber(amount)
    ? amount
    : ethers.utils.parseUnits(amount.toString(), assetDecimals)
  await getAsset(chainId, assetAddress, depositAmount, depositor.address)
  await assetContract.connect(depositor).approve(neuronPool.address, depositAmount)
  await neuronPool.connect(depositor).deposit(depositAmount)
}
