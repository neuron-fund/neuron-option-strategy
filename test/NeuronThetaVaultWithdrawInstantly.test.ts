import { expect } from 'chai'
import { BigNumber } from 'ethers'
import * as time from '../helpers/time'
import { assert } from '../helpers/assertions'
import { initiateVault, VaultTestParams } from '../helpers/vault'
import { NeuronEthThetaVaultCallTestParams } from '../helpers/testParams'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#completeWithdraw', async function (params) {
  const {
    user,
    userSigner,
    ownerSigner,
    isPut,
    assetContract,
    collateralVaults,
    collateralAssetsContracts,
    firstOptionStrike,
    rollToNextOption,
    rollToSecondOption,
  } = params
  const depositAmount = params.depositAmount
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]
  await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

  await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, ownerSigner)

  await rollToNextOption()

  await collateralVault.connect(userSigner).initiateWithdraw(depositAmount)

  return () => {
    it('reverts when not initiated', async function () {
      await expect(collateralVault.connect(ownerSigner).completeWithdraw()).to.be.revertedWith('Not initiated')
    })

    it('reverts when round not closed', async function () {
      await expect(collateralVault.connect(userSigner).completeWithdraw()).to.be.revertedWith('Round not closed')
    })

    it('reverts when calling completeWithdraw twice', async function () {
      await rollToSecondOption(firstOptionStrike)

      await collateralVault.connect(userSigner).completeWithdraw()

      await expect(collateralVault.connect(userSigner).completeWithdraw()).to.be.revertedWith('Not initiated')
    })

    it('completes the withdrawal', async function () {
      const firstStrikePrice = firstOptionStrike
      const settlePriceITM = isPut ? firstStrikePrice.sub(100000000) : firstStrikePrice.add(100000000)

      await rollToSecondOption(settlePriceITM)

      const pricePerShare = await collateralVault.roundPricePerShare(2)
      const withdrawAmount = depositAmount
        .mul(pricePerShare)
        .div(BigNumber.from(10).pow(await collateralVault.decimals()))
      const lastQueuedWithdrawAmount = await collateralVault.lastQueuedWithdrawAmount()

      let beforeBalance: BigNumber
      beforeBalance = await assetContract.balanceOf(user)

      const { queuedWithdrawShares: startQueuedShares } = await collateralVault.vaultState()

      const tx = await collateralVault.connect(userSigner).completeWithdraw()
      await expect(tx).to.emit(collateralVault, 'Withdraw').withArgs(user, withdrawAmount.toString(), depositAmount)

      await expect(tx).to.emit(assetContract, 'Transfer').withArgs(collateralVault.address, user, withdrawAmount)

      const { shares, round } = await collateralVault.connect(userSigner).withdrawals(user)
      assert.bnEqual(shares, BigNumber.from(0))
      assert.equal(round, 2)

      const { queuedWithdrawShares: endQueuedShares } = await collateralVault.connect(userSigner).vaultState()

      assert.bnEqual(endQueuedShares, BigNumber.from(0))
      assert.bnEqual(
        await collateralVault.connect(userSigner).lastQueuedWithdrawAmount(),
        lastQueuedWithdrawAmount.sub(withdrawAmount)
      )
      assert.bnEqual(startQueuedShares.sub(endQueuedShares), depositAmount)

      let actualWithdrawAmount: BigNumber
      const afterBalance = await assetContract.balanceOf(user)
      actualWithdrawAmount = afterBalance.sub(beforeBalance)
      // Should be less because the pps is down
      assert.bnLt(actualWithdrawAmount, depositAmount)
      assert.bnEqual(actualWithdrawAmount, withdrawAmount)
    })
  }
})
