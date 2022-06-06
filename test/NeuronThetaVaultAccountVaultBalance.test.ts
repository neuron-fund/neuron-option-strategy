import { BigNumber } from 'ethers'
import { CHAINID } from '../constants/constants'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('accountVaultBalance', async function (params) {
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

  return () => {
    it('returns a lesser underlying amount for user', async function () {
      let collateralVault = collateralVaults[0]
      let neuronPool = collateralAssetsContracts[0]
      const { depositAmount } = params
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      await rollToNextOption()

      assert.bnEqual(await collateralVault.connect(userSigner).accountVaultBalance(user), BigNumber.from(depositAmount))

      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, ownerSigner)

      // remain the same after deposit
      assert.bnEqual(await collateralVault.connect(userSigner).accountVaultBalance(user), BigNumber.from(depositAmount))

      const AMOUNT = {
        [CHAINID.ETH_MAINNET]: '100000000000',
        [CHAINID.AVAX_MAINNET]: '1000000000',
        [CHAINID.AURORA_MAINNET]: '1000000000',
      }

      const settlementPriceITM = isPut
        ? firstOptionStrike.sub(AMOUNT[CHAINID.ETH_MAINNET])
        : firstOptionStrike.add(AMOUNT[CHAINID.ETH_MAINNET])

      await rollToSecondOption(settlementPriceITM)

      // Minus 1 due to rounding errors from share price != 1
      assert.bnLt(await collateralVault.connect(userSigner).accountVaultBalance(user), BigNumber.from(depositAmount))
    })
  }
})
