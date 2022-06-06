import { Contract } from 'ethers'
import * as time from '../helpers/time'
import { setupOracle } from '../helpers/utils'
import { initiateVault, VaultTestParams } from '../helpers/vault'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#settleAuctionAndSwap', async function (params) {
  const { userSigner, ownerSigner, collateralVaults, collateralAssetsContracts } = params
  const depositAmount = params.depositAmount
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]
  await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

  const oracle = await setupOracle(params.underlying, ownerSigner)

  return () => {
    // if (isUsdcAuction) {
    //   it('reverts when not keeper call', async function () {
    //     await expect(vault.settleAuctionAndSwap('1')).to.be.revertedWith('!keeper')
    //   })
    //   it('reverts when minimum amount out <= 0', async function () {
    //     await expect(vault.connect(keeperSigner).settleAuctionAndSwap('0')).to.be.revertedWith('!minAmountOut')
    //   })
    //   it('reverts when minimum amount out is not filled', async function () {
    //     await vault.connect(ownerSigner).commitAndClose()
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
    //     await vault.connect(keeperSigner).rollToNextOption()
    //     let bidMultiplier = 1
    //     const auctionDetails = await bidForONToken(
    //       gnosisAuction,
    //       auctionBiddingTokenContract,
    //       userSigner.address,
    //       defaultONtokenAddress,
    //       firstOptionPremium,
    //       auctionBiddingTokenDecimals,
    //       bidMultiplier.toString(),
    //       auctionDuration
    //     )
    //     // Ideal output with no slippage
    //     let idealOut = wdiv(
    //       BigNumber.from(auctionDetails[2]).mul(10 ** (18 - 6)), // USDC adjusted to 18 decimals
    //       (await oracle.getPrice(asset)).mul(10 ** (18 - 8)) // Oracle adjusted to 18 decimals
    //     )
    //     await expect(vault.connect(keeperSigner).settleAuctionAndSwap(idealOut)).to.be.revertedWith(
    //       'Too little received'
    //     )
    //   })
    //   it('swap returns amount above the minimum amount', async function () {
    //     await vault.connect(ownerSigner).commitAndClose()
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
    //     await vault.connect(keeperSigner).rollToNextOption()
    //     let bidMultiplier = 1
    //     const auctionDetails = await bidForONToken(
    //       gnosisAuction,
    //       auctionBiddingTokenContract,
    //       userSigner.address,
    //       defaultONtokenAddress,
    //       firstOptionPremium,
    //       auctionBiddingTokenDecimals,
    //       bidMultiplier.toString(),
    //       auctionDuration
    //     )
    //     let idealOut = wdiv(
    //       BigNumber.from(auctionDetails[2]).mul(10 ** (18 - 6)), // USDC adjusted to 18 decimals
    //       (await oracle.getPrice(asset)).mul(10 ** (18 - 8)) // Oracle adjusted to 18 decimals
    //     )
    //     let slippage = 10000 //10% slippage
    //     let minAmountOut = idealOut.mul(100000 - slippage).div(100000)
    //     await vault.connect(keeperSigner).settleAuctionAndSwap(minAmountOut)
    //     let proceeds = await assetContract.balanceOf(vault.address)
    //     assert.isAbove(parseInt(proceeds), parseInt(minAmountOut.toString()))
    //   })
    // } else {
    //   it('reverts when isUsdcAuction is false', async function () {
    //     await expect(collateralVault.connect(keeperSigner).settleAuctionAndSwap('1')).to.be.revertedWith(
    //       '!isUsdcAuction'
    //     )
    //   })
    // }
  }
})
