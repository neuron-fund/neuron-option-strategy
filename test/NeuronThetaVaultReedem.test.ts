import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#redeem', async function (params) {
  const { user, userSigner, collateralVaults, collateralAssetsContracts, rollToNextOption, depositAmount } = params

  return () => {
    it('reverts when 0 passed', async function () {
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      await rollToNextOption()
      await expect(collateralVault.connect(userSigner).redeem(0)).to.be.revertedWith('!numShares')
    })

    it('reverts when redeeming more than available', async function () {
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      await rollToNextOption()

      await expect(collateralVault.connect(userSigner).redeem(depositAmount.add(1))).to.be.revertedWith(
        'Exceeds available'
      )
    })

    it('decreases unredeemed shares', async function () {
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      await rollToNextOption()

      const redeemAmount = BigNumber.from(1)
      const tx1 = await collateralVault.connect(userSigner).redeem(redeemAmount)

      await expect(tx1).to.emit(collateralVault, 'Redeem').withArgs(user, redeemAmount, 1)

      const {
        round: round1,
        amount: amount1,
        unredeemedShares: unredeemedShares1,
      } = await collateralVault.depositReceipts(user)

      assert.equal(round1, 1)
      assert.bnEqual(amount1, BigNumber.from(0))
      assert.bnEqual(unredeemedShares1, depositAmount.sub(redeemAmount))

      const tx2 = await collateralVault.connect(userSigner).redeem(depositAmount.sub(redeemAmount))

      await expect(tx2).to.emit(collateralVault, 'Redeem').withArgs(user, depositAmount.sub(redeemAmount), 1)

      const {
        round: round2,
        amount: amount2,
        unredeemedShares: unredeemedShares2,
      } = await collateralVault.connect(userSigner).depositReceipts(user)

      assert.equal(round2, 1)
      assert.bnEqual(amount2, BigNumber.from(0))
      assert.bnEqual(unredeemedShares2, BigNumber.from(0))
    })
  }
})
