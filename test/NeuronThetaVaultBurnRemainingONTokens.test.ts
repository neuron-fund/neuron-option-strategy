import { expect } from 'chai'
import { BigNumber } from 'ethers'
import * as time from '../helpers/time'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { bidForONToken, getOracle, setOracleExpiryPriceNeuron, setupOracle } from '../helpers/utils'
import { runVaultTests } from '../helpers/runVaultTests'
import { DELAY_INCREMENT } from '../helpers/vault'

runVaultTests('#burnRemainingONTokens', async function (params) {
  const {
    userSigner,
    ownerSigner,
    keeperSigner,
    vault,
    collateralVaults,
    collateralAssetsContracts,
    getNextOptionReadyAt,
    gnosisAuction,
    usdcContract,
    defaultONtokenAddress,
    firstOptionPremium,
    auctionDuration,
    defaultONtoken,
    firstOptionStrike,
    isPut,
    getCurrentOptionExpiry,
    collateralAssetsOracles,
    secondOptionStrike,
  } = params
  const depositAmount = params.depositAmount
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]
  await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
  const oracle = await setupOracle(params.underlying, ownerSigner)

  return () => {
    it('reverts when not called with keeper', async function () {
      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT)

      await vault.connect(keeperSigner).rollToNextOption()

      await expect(vault.connect(ownerSigner).burnRemainingONTokens()).to.be.revertedWith('!keeper')
    })

    it('reverts when trying to burn 0 ONTokens', async function () {
      await vault.connect(ownerSigner).commitAndClose()

      await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT)

      await vault.connect(keeperSigner).rollToNextOption()

      let bidMultiplier = 1

      const auctionDetails = await bidForONToken(
        gnosisAuction,
        usdcContract,
        userSigner.address,
        defaultONtokenAddress,
        firstOptionPremium,
        6,
        bidMultiplier.toString(),
        auctionDuration
      )

      assert.equal((await defaultONtoken.balanceOf(vault.address)).toString(), '0')

      await gnosisAuction.connect(userSigner).settleAuction(auctionDetails[0])

      assert.equal((await defaultONtoken.balanceOf(vault.address)).toString(), '0')

      await expect(vault.connect(keeperSigner).burnRemainingONTokens()).to.be.revertedWith('No onTokens to burn')
    })

    // TODO Correct calcs for this test
    // it('burns all remaining onTokens', async function () {
    //   await vault.connect(ownerSigner).commitAndClose()

    //   await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT)

    //   await vault.connect(keeperSigner).rollToNextOption()

    //   let bidMultiplier = 2

    //   const auctionDetails = await bidForONToken(
    //     gnosisAuction,
    //     usdcContract,
    //     userSigner.address,
    //     defaultONtokenAddress,
    //     firstOptionPremium,
    //     6,
    //     bidMultiplier.toString(),
    //     auctionDuration
    //   )

    //   assert.equal((await defaultONtoken.balanceOf(vault.address)).toString(), '0')

    //   const assetBalanceBeforeSettle = await assetContract.balanceOf(vault.address)

    //   await gnosisAuction.connect(userSigner).settleAuction(auctionDetails[0])

    //   // Asset balance when auction closes only contains auction proceeds
    //   // Remaining vault's balance is still in Option Protocol Gamma Controller
    //   let auctionProceeds = await assetContract.balanceOf(vault.address)

    //   assert.isAbove(
    //     parseInt((await defaultONtoken.balanceOf(vault.address)).toString()),
    //     parseInt(params.expectedMintAmount.div(bidMultiplier).mul(params.premiumDiscount.sub(1)).div(1000).toString())
    //   )

    //   assert.isAbove(
    //     parseInt((await assetContract.balanceOf(vault.address)).toString()),
    //     parseInt(((assetBalanceBeforeSettle.add(auctionProceeds) * 99) / 100).toString())
    //   )

    //   const lockedAmountBeforeBurn = (await vault.vaultState()).lockedAmount
    //   const assetBalanceAfterSettle = await assetContract.balanceOf(vault.address)
    //   const collateralVaultsAssetsBalancesBeforeBurn = await Promise.all(
    //     collateralVaults.map(vault => assetContract.balanceOf(vault.address))
    //   )
    //   vault.connect(keeperSigner).burnRemainingONTokens()
    //   let assetBalanceAfterBurn = await assetContract.balanceOf(vault.address)
    //   for (const [i, collateralVault] of collateralVaults.entries()) {
    //     const balanceAfterBurn = await assetContract.balanceOf(collateralVault.address)
    //     const afterBurnDiff = balanceAfterBurn.sub(collateralVaultsAssetsBalancesBeforeBurn[i])
    //     assetBalanceAfterBurn = assetBalanceAfterBurn.add(afterBurnDiff)
    //   }

    //   assert.isAbove(
    //     parseInt(assetBalanceAfterBurn.toString()),
    //     parseInt(
    //       assetBalanceAfterSettle
    //         .add(lockedAmountBeforeBurn.div(bidMultiplier).mul(params.premiumDiscount.sub(1)).div(1000))
    //         .toString()
    //     )
    //   )
    // })
  }
})
