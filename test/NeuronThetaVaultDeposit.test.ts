import { depositToNeuronPool } from '../helpers/neuronPool'
import { BigNumber } from '@ethersproject/bignumber'
import { assert } from '../helpers/assertions'
import { expect } from 'chai'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { CHAINID } from '../constants/constants'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#deposit', async function (params) {
  const {
    collateralVaults,
    collateralAssetsContracts,
    user,
    userSigner,
    adminSigner,
    rollToNextOption,
    minimumSupply,
  } = params

  return () => {
    const depositAmount = params.depositAmount
    let collateralVault = collateralVaults[0]
    let neuronPool = collateralAssetsContracts[0]

    it('creates a pending deposit', async function () {
      const { tx } = await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      assert.isTrue((await neuronPool.balanceOf(user)).isZero())
      assert.isTrue((await collateralVault.totalSupply()).isZero())
      assert.isTrue((await collateralVault.balanceOf(user)).isZero())
      await expect(tx).to.emit(collateralVault, 'Deposit').withArgs(user, depositAmount, 1)
      assert.bnEqual(await collateralVault.totalPending(), depositAmount)
      const { round, amount } = await collateralVault.depositReceipts(user)
      assert.equal(round, 1)
      assert.bnEqual(amount, depositAmount)
    })
    it('tops up existing deposit', async function () {
      const totalDepositAmount = depositAmount.mul(BigNumber.from(2))

      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      const { tx } = await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      assert.isTrue((await neuronPool.balanceOf(user)).isZero())
      assert.isTrue((await collateralVault.totalSupply()).isZero())
      assert.isTrue((await collateralVault.balanceOf(user)).isZero())
      await expect(tx).to.emit(collateralVault, 'Deposit').withArgs(user, depositAmount, 1)
      assert.bnEqual(await collateralVault.totalPending(), totalDepositAmount)
      const { round, amount } = await collateralVault.depositReceipts(user)
      assert.equal(round, 1)
      assert.bnEqual(amount, totalDepositAmount)
    })
    it('does not inflate the share tokens on initialization', async function () {
      const depositAmount = BigNumber.from('100000000000')

      await depositToNeuronPool(CHAINID.ETH_MAINNET, neuronPool, adminSigner, depositAmount)
      await neuronPool.connect(adminSigner).transfer(collateralVault.address, depositAmount)

      await depositIntoCollateralVault(collateralVault, neuronPool, BigNumber.from('10000000000'), userSigner)
      // user needs to get back exactly 1 ether
      // even though the total has been incremented
      assert.isTrue((await collateralVault.balanceOf(user)).isZero())
    })
    it('reverts when minimum shares are not minted', async function () {
      const depositAmount = BigNumber.from(minimumSupply).sub(BigNumber.from('1'))
      await depositToNeuronPool(CHAINID.ETH_MAINNET, neuronPool, userSigner, depositAmount)
      const collateralBalanceStarted = await neuronPool.connect(userSigner).balanceOf(userSigner.address)
      const neuronPoolPricePerShare = await neuronPool.connect(userSigner).pricePerShare()
      const withdrawAmount = neuronPoolPricePerShare.mul(collateralBalanceStarted).div(BigNumber.from(10).pow(18))
      assert.bnEqual(withdrawAmount, depositAmount, 'Collateral withdraw amount is not equal to deposit amount')
      await neuronPool.connect(userSigner).approve(collateralVault.address, collateralBalanceStarted)

      await expect(
        collateralVault.connect(userSigner).deposit(collateralBalanceStarted, neuronPool.address)
      ).to.be.revertedWith('Insufficient balance')
    })
    it('updates the previous deposit receipt', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, params.depositAmount, userSigner)
      const {
        round: round1,
        amount: amount1,
        unredeemedShares: unredeemedShares1,
      } = await collateralVault.depositReceipts(user)
      assert.equal(round1, 1)
      assert.bnEqual(amount1, params.depositAmount)
      assert.bnEqual(unredeemedShares1, BigNumber.from(0))
      await rollToNextOption()
      const {
        round: round2,
        amount: amount2,
        unredeemedShares: unredeemedShares2,
      } = await collateralVault.depositReceipts(user)
      assert.equal(round2, 1)
      assert.bnEqual(amount2, params.depositAmount)
      assert.bnEqual(unredeemedShares2, BigNumber.from(0))
      await depositIntoCollateralVault(collateralVault, neuronPool, params.depositAmount, userSigner)
      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), params.depositAmount)
      // vault will still hold the vault shares
      assert.bnEqual(await collateralVault.balanceOf(collateralVault.address), params.depositAmount)
      const {
        round: round3,
        amount: amount3,
        unredeemedShares: unredeemedShares3,
      } = await collateralVault.depositReceipts(user)
      assert.equal(round3, 2)
      assert.bnEqual(amount3, params.depositAmount)
      assert.bnEqual(unredeemedShares3, params.depositAmount)
    })
  }
})
