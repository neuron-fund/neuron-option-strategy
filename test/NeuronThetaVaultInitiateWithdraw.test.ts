import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'
import { setOpynOracleExpiryPriceNeuron, setupOracle } from '../helpers/utils'
import * as time from '../helpers/time'

runVaultTests('#initiateWithdraw', async function (params) {
  const {
    user,
    userSigner,
    ownerSigner,
    collateralVaults,
    collateralAssetsContracts,
    firstOptionStrike,
    rollToNextOption,
    depositAmount,
    collateralAssetsOracles,
    vault,
    secondOptionStrike,
    getCurrentOptionExpiry,
    keeperSigner,
    underlying,
  } = params
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]
  const oracle = await setupOracle(underlying, ownerSigner)

  return () => {
    it('reverts when user initiates withdraws without any deposit', async function () {
      await expect(collateralVault.initiateWithdraw(depositAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
    })

    it('reverts when passed 0 shares', async function () {
      await expect(collateralVault.initiateWithdraw(0)).to.be.revertedWith('!numShares')
    })

    it('reverts when withdrawing more than unredeemed balance', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await expect(collateralVault.connect(userSigner).initiateWithdraw(depositAmount.add(1))).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
    })

    it('reverts when withdrawing more than vault + account balance', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      // Move 1 share into account
      await collateralVault.connect(userSigner).redeem(1)

      await expect(collateralVault.connect(userSigner).initiateWithdraw(depositAmount.add(1))).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
    })

    it('reverts when initiating with past existing withdrawal', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await collateralVault.connect(userSigner).initiateWithdraw(depositAmount.div(2))

      // TODO remove opyn everywhere
      await setOpynOracleExpiryPriceNeuron(
        underlying,
        oracle,
        firstOptionStrike,
        collateralAssetsOracles,
        await getCurrentOptionExpiry()
      )
      await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike)
      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
      await vault.connect(keeperSigner).rollToNextOption()

      await expect(collateralVault.connect(userSigner).initiateWithdraw(depositAmount.div(2))).to.be.revertedWith(
        'Existing withdraw'
      )
    })

    it('creates withdrawal from unredeemed shares', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      const tx = await collateralVault.connect(userSigner).initiateWithdraw(depositAmount)

      await expect(tx).to.emit(collateralVault, 'InitiateWithdraw').withArgs(user, depositAmount, 2)

      await expect(tx).to.emit(collateralVault, 'Transfer').withArgs(collateralVault.address, user, depositAmount)

      const { round, shares } = await collateralVault.connect(userSigner).withdrawals(user)
      assert.equal(round, 2)
      assert.bnEqual(shares, depositAmount)
    })

    it('creates withdrawal by debiting user shares', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await collateralVault.connect(userSigner).redeem(depositAmount.div(2))

      const tx = await collateralVault.connect(userSigner).initiateWithdraw(depositAmount)

      await expect(tx).to.emit(collateralVault, 'InitiateWithdraw').withArgs(user, depositAmount, 2)

      // First we redeem the leftover amount
      await expect(tx)
        .to.emit(collateralVault, 'Transfer')
        .withArgs(collateralVault.address, user, depositAmount.div(2))

      // Then we debit the shares from the user
      await expect(tx).to.emit(collateralVault, 'Transfer').withArgs(user, collateralVault.address, depositAmount)

      assert.bnEqual(await collateralVault.balanceOf(user), BigNumber.from(0))
      assert.bnEqual(await collateralVault.balanceOf(collateralVault.address), depositAmount)

      const { round, shares } = await collateralVault.withdrawals(user)
      assert.equal(round, 2)
      assert.bnEqual(shares, depositAmount)
    })

    it('tops up existing withdrawal', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      const tx1 = await collateralVault.connect(userSigner).initiateWithdraw(depositAmount.div(2))
      // We redeem the full amount on the first initiateWithdraw
      await expect(tx1).to.emit(collateralVault, 'Transfer').withArgs(collateralVault.address, user, depositAmount)
      await expect(tx1)
        .to.emit(collateralVault, 'Transfer')
        .withArgs(user, collateralVault.address, depositAmount.div(2))

      const tx2 = await collateralVault.connect(userSigner).initiateWithdraw(depositAmount.div(2))
      await expect(tx2)
        .to.emit(collateralVault, 'Transfer')
        .withArgs(user, collateralVault.address, depositAmount.div(2))

      const { round, shares } = await collateralVault.connect(userSigner).withdrawals(user)
      assert.equal(round, 2)
      assert.bnEqual(shares, depositAmount)
    })
    it('reverts when there is insufficient balance over multiple calls', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await collateralVault.connect(userSigner).initiateWithdraw(depositAmount.div(2))

      await expect(
        collateralVault.connect(userSigner).initiateWithdraw(depositAmount.div(2).add(1))
      ).to.be.revertedWith('ERC20: transfer amount exceeds balance')
    })
  }
})
