import { BigNumber } from 'ethers'
import * as time from '../helpers/time'
import { assert } from '../helpers/assertions'
import { initiateVault, VaultTestParams } from '../helpers/vault'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { NeuronEthThetaVaultCallTestParams } from '../helpers/testParams'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#shares', async function (params) {
  const { owner, user, userSigner, collateralVaults, collateralAssetsContracts, rollToNextOption } = params

  return () => {
    it('shows correct share balance after redemptions', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      assert.bnEqual(await collateralVault.connect(userSigner).shares(user), depositAmount)

      const redeemAmount = BigNumber.from(1)
      await collateralVault.connect(userSigner).redeem(redeemAmount)

      // Share balance should remain the same because the 1 share
      // is transferred to the user
      assert.bnEqual(await collateralVault.connect(userSigner).shares(user), depositAmount)

      await collateralVault.connect(userSigner).transfer(owner, redeemAmount)

      assert.bnEqual(await collateralVault.connect(userSigner).shares(user), depositAmount.sub(redeemAmount))
      assert.bnEqual(await collateralVault.connect(userSigner).shares(owner), redeemAmount)
    })

    it('returns the share balances split', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      const [heldByAccount1, heldByVault1] = await collateralVault.connect(userSigner).shareBalances(user)
      assert.bnEqual(heldByAccount1, BigNumber.from(0))
      assert.bnEqual(heldByVault1, depositAmount)

      await collateralVault.connect(userSigner).redeem(1)
      const [heldByAccount2, heldByVault2] = await collateralVault.connect(userSigner).shareBalances(user)
      assert.bnEqual(heldByAccount2, BigNumber.from(1))
      assert.bnEqual(heldByVault2, depositAmount.sub(1))
    })

    it('returns the total number of shares', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      assert.bnEqual(await collateralVault.connect(userSigner).shares(user), depositAmount)

      // Should remain the same after redemption because it's held on balanceOf
      await collateralVault.connect(userSigner).redeem(1)
      assert.bnEqual(await collateralVault.connect(userSigner).shares(user), depositAmount)
    })
  }
})
