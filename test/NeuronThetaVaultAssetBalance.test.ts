import { BigNumber } from 'ethers'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#assetBalance', async function (params) {
  const { userSigner, collateralVaults, collateralAssetsContracts, rollToNextOption } = params
  const depositAmount = params.depositAmount
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]
  await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
  await rollToNextOption()

  return () => {
    it('returns the free balance - locked, if free > locked', async function () {
      const newDepositAmount = BigNumber.from('1000000000000')
      await depositIntoCollateralVault(collateralVault, neuronPool, newDepositAmount, userSigner)

      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), newDepositAmount)
    })
  }
})
