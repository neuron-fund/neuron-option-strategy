import { BigNumber } from 'ethers'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#accountVaultBalance', async function (params) {
  const {
    user,
    userSigner,
    ownerSigner,
    isPut,
    collateralVaults,
    collateralAssetsContracts,
    firstOptionStrike,
    rollToSecondOption,
    rollToNextOption,
  } = params
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]
  const { depositAmount } = params

  return () => {
    it('returns a lesser underlying amount for user', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      await rollToNextOption()

      assert.bnEqual(await collateralVault.connect(userSigner).accountVaultBalance(user), BigNumber.from(depositAmount))

      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, ownerSigner)

      // remain the same after deposit
      assert.bnEqual(await collateralVault.connect(userSigner).accountVaultBalance(user), BigNumber.from(depositAmount))

      const AMOUNT = '10000'

      const settlementPriceITM = isPut ? firstOptionStrike.sub(AMOUNT) : firstOptionStrike.add(AMOUNT)

      await rollToSecondOption(settlementPriceITM)

      // Minus 1 due to rounding errors from share price != 1
      assert.bnLt(await collateralVault.connect(userSigner).accountVaultBalance(user), BigNumber.from(depositAmount))
    })
  }
})
