import { expect } from 'chai'
import { BigNumber } from 'ethers'
import * as time from '../helpers/time'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { CHAINID } from '../constants/constants'
import { setOracleExpiryPriceNeuron, setupOracle } from '../helpers/utils'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#maxRedeem', async function (params) {
  const {
    owner,
    user,
    userSigner,
    ownerSigner,
    keeperSigner,
    isPut,
    strikeSelection,
    vault,
    collateralVaults,
    collateralAssetsContracts,
    collateralAssetsOracles,
    firstOptionStrike,
    rollToNextOption,
    getCurrentOptionExpiry,
  } = params
  const oracle = await setupOracle(params.underlying, ownerSigner)

  return () => {
    it('is able to redeem deposit at new price per share', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      collateralVault = collateralVaults[0]
      neuronPool = collateralAssetsContracts[0]
      const { collateralAmountDeposited } = await depositIntoCollateralVault(
        collateralVault,
        neuronPool,
        depositAmount,
        userSigner
      )

      await rollToNextOption()

      const tx = await collateralVault.connect(userSigner).maxRedeem()

      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), BigNumber.from(0))
      assert.bnEqual(await collateralVault.balanceOf(user), collateralAmountDeposited)
      assert.bnEqual(await collateralVault.balanceOf(collateralVault.address), BigNumber.from(0))

      await expect(tx).to.emit(collateralVault, 'Redeem').withArgs(user, collateralAmountDeposited, 1)

      const { round, amount, unredeemedShares } = await collateralVault.depositReceipts(user)

      assert.equal(round, 1)
      assert.bnEqual(amount, BigNumber.from(0))
      assert.bnEqual(unredeemedShares, BigNumber.from(0))
    })

    it('changes balance only once when redeeming twice', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      collateralVault = collateralVaults[0]
      neuronPool = collateralAssetsContracts[0]
      const { collateralAmountDeposited } = await depositIntoCollateralVault(
        collateralVault,
        neuronPool,
        depositAmount,
        userSigner
      )

      await rollToNextOption()

      const tx = await collateralVault.connect(userSigner).maxRedeem()

      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), BigNumber.from(0))
      assert.bnEqual(await collateralVault.balanceOf(user), collateralAmountDeposited)
      assert.bnEqual(await collateralVault.balanceOf(collateralVault.address), BigNumber.from(0))

      await expect(tx).to.emit(collateralVault, 'Redeem').withArgs(user, collateralAmountDeposited, 1)

      const { round, amount, unredeemedShares } = await collateralVault.depositReceipts(user)

      assert.equal(round, 1)
      assert.bnEqual(amount, BigNumber.from(0))
      assert.bnEqual(unredeemedShares, BigNumber.from(0))

      let res = await collateralVault.connect(userSigner).maxRedeem()

      await expect(res).to.not.emit(collateralVault, 'Transfer')

      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), BigNumber.from(0))
      assert.bnEqual(await collateralVault.balanceOf(user), collateralAmountDeposited)
      assert.bnEqual(await collateralVault.balanceOf(collateralVault.address), BigNumber.from(0))
    })

    it('redeems after a deposit what was unredeemed from previous rounds', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      collateralVault = collateralVaults[0]
      neuronPool = collateralAssetsContracts[0]
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      const tx = await collateralVault.connect(userSigner).maxRedeem()

      await expect(tx).to.emit(collateralVault, 'Redeem').withArgs(user, params.depositAmount, 2)
    })

    it('is able to redeem deposit at correct pricePerShare after closing short in the money', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, ownerSigner)

      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
      await vault.connect(keeperSigner).rollToNextOption()

      // Mid-week deposit in round 2
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      const vaultState = await collateralVault.vaultState()

      const beforeBalance = (await neuronPool.balanceOf(collateralVault.address)).add(vaultState.lockedAmount)

      const beforePps = await collateralVault.pricePerShare()

      const AMOUNT = '100000000000'

      const settlementPriceITM = isPut ? firstOptionStrike.sub(AMOUNT) : firstOptionStrike.add(AMOUNT)

      await setOracleExpiryPriceNeuron(
        params.underlying,
        oracle,
        settlementPriceITM,
        collateralAssetsOracles,
        await getCurrentOptionExpiry()
      )

      await strikeSelection.setDelta(params.deltaSecondOption)

      await vault.connect(ownerSigner).commitAndClose()
      const afterBalance = await neuronPool.balanceOf(collateralVault.address)
      const afterPps = await collateralVault.pricePerShare()
      const expectedMintAmountAfterLoss = params.depositAmount
        .mul(BigNumber.from(10).pow(params.tokenDecimals))
        .div(afterPps)

      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
      await vault.connect(keeperSigner).rollToNextOption()

      assert.bnGt(beforeBalance, afterBalance)
      assert.bnGt(beforePps, afterPps)

      // owner should lose money
      // User should not lose money
      // owner redeems the deposit from round 1 so there is a loss from ITM options
      const tx1 = await collateralVault.connect(ownerSigner).maxRedeem()
      await expect(tx1).to.emit(collateralVault, 'Redeem').withArgs(owner, params.depositAmount, 1)

      const {
        round: round1,
        amount: amount1,
        unredeemedShares: unredeemedShares1,
      } = await collateralVault.depositReceipts(owner)
      assert.equal(round1, 1)
      assert.bnEqual(amount1, BigNumber.from(0))
      assert.bnEqual(unredeemedShares1, BigNumber.from(0))
      assert.bnEqual(await collateralVault.balanceOf(owner), params.depositAmount)

      // User deposit in round 2 so no loss
      // we should use the pps after the loss which is the lower pps
      const tx2 = await collateralVault.connect(userSigner).maxRedeem()
      await expect(tx2).to.emit(collateralVault, 'Redeem').withArgs(user, expectedMintAmountAfterLoss, 2)

      const {
        round: round2,
        amount: amount2,
        unredeemedShares: unredeemedShares2,
      } = await collateralVault.depositReceipts(user)
      assert.equal(round2, 2)
      assert.bnEqual(amount2, BigNumber.from(0))
      assert.bnEqual(unredeemedShares2, BigNumber.from(0))
      assert.bnEqual(await collateralVault.balanceOf(user), expectedMintAmountAfterLoss)
    })
  }
})
