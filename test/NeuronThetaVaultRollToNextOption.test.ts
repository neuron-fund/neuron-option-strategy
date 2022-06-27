import { expect } from 'chai'
import { BigNumber, constants } from 'ethers'
import * as time from '../helpers/time'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import {
  bidForONToken,
  convertPriceAmount,
  decodeOrder,
  lockedBalanceForRollover,
  setOracleExpiryPriceNeuron,
  setupOracle,
} from '../helpers/utils'
import { GNOSIS_EASY_AUCTION } from '../constants/constants'
import { ethers } from 'hardhat'
import { runVaultTests } from '../helpers/runVaultTests'
import { depositToNeuronPool } from '../helpers/neuronPool'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

runVaultTests('#rollToNextOption', async function (params) {
  const {
    owner,
    keeper,
    user,
    userSigner,
    ownerSigner,
    keeperSigner,
    isPut,
    optionsPremiumPricer,
    gnosisAuction,
    vault,
    defaultONtoken,
    underlyingContract,
    collateralVaults,
    collateralAssetsContracts,
    collateralAssetsOracles,
    auctionBiddingTokenContract,
    auctionBiddingTokenDecimals,
    defaultONtokenAddress,
    firstOptionStrike,
    firstOptionPremium,
    premiumCalcToken,
    secondOptionStrike,
    firstOption,
    secondOption,
    getCurrentOptionExpiry,
    rollToSecondOption,
    auctionBiddingToken,
    auctionDuration,
    marginPoolAddress,
    depositAmount,
  } = params

  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]
  const depositedCollateralsAmounts = new Array(collateralVaults.length).fill(BigNumber.from(0))
  const oracle = await setupOracle(params.underlying, ownerSigner)
  const { collateralAmountDeposited } = await depositIntoCollateralVault(
    collateralVault,
    neuronPool,
    depositAmount,
    userSigner
  )
  depositedCollateralsAmounts[0] = collateralAmountDeposited

  return () => {
    it('reverts when not called with keeper', async function () {
      await expect(vault.connect(ownerSigner).rollToNextOption()).to.be.revertedWith('!keeper')
    })

    it('mints onTokens and deposits collateral into vault', async function () {
      const startMarginBalance = await underlyingContract.balanceOf(marginPoolAddress)

      await vault.connect(ownerSigner).commitAndClose()

      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      const res = await vault.connect(keeperSigner).rollToNextOption()
      await expect(res).to.not.emit(vault, 'CloseShort')

      await expect(res)
        .to.emit(vault, 'OpenShort')
        .withArgs(defaultONtokenAddress, depositedCollateralsAmounts, anyValue, keeper)

      const vaultState = await collateralVault.vaultState()

      assert.equal(vaultState.lockedAmount.toString(), depositAmount.toString())

      assert.bnEqual(await neuronPool.balanceOf(vault.address), BigNumber.from(0))

      assert.equal(
        (await neuronPool.balanceOf(marginPoolAddress)).sub(startMarginBalance).toString(),
        depositAmount.toString()
      )

      assert.bnGt(await defaultONtoken.balanceOf(GNOSIS_EASY_AUCTION), BigNumber.from(0))

      assert.equal(await vault.currentOption(), defaultONtokenAddress)
    })

    it('starts auction with correct parameters', async function () {
      await vault.connect(ownerSigner).commitAndClose()

      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      const nextOption = await ethers.getContractAt('IONtoken', await vault.nextOption())

      await vault.connect(keeperSigner).rollToNextOption()

      const currentAuctionCounter = await gnosisAuction.auctionCounter()
      const auctionDetails = await gnosisAuction.auctionData(currentAuctionCounter.toString())
      const feeNumerator = await gnosisAuction.feeNumerator()

      assert.equal(auctionDetails.auctioningToken, defaultONtokenAddress)
      assert.equal(auctionDetails.biddingToken, auctionBiddingToken)
      assert.equal(auctionDetails.orderCancellationEndDate.toString(), (await time.now()).add(21600).toString())
      assert.equal(auctionDetails.auctionEndDate.toString(), (await time.now()).add(21600).toString())
      assert.equal(auctionDetails.minimumBiddingAmountPerOrder.toString(), '1')
      assert.equal(auctionDetails.isAtomicClosureAllowed, false)
      assert.equal(auctionDetails.feeNumerator.toString(), feeNumerator.toString())
      assert.equal(auctionDetails.minFundingThreshold.toString(), '0')
      assert.equal(await gnosisAuction.auctionAccessManager(currentAuctionCounter), constants.AddressZero)
      assert.equal(await gnosisAuction.auctionAccessData(currentAuctionCounter), '0x')

      const initialAuctionOrder = decodeOrder(auctionDetails.initialAuctionOrder)

      // const onTokenSellAmount = params.expectedMintAmount.mul(feeDenominator).div(feeDenominator.add(feeNumerator))

      let onTokenPremium = (
        await optionsPremiumPricer.getPremium(
          await nextOption.strikePrice(),
          await nextOption.expiryTimestamp(),
          params.isPut
        )
      )
        .mul(await vault.premiumDiscount())
        .div(1000)

      if (auctionBiddingTokenContract.address !== premiumCalcToken) {
        onTokenPremium = await convertPriceAmount(
          premiumCalcToken,
          auctionBiddingTokenContract.address,
          onTokenPremium,
          userSigner
        )
      }
      // TODO reenable
      // assert.equal(initialAuctionOrder.sellAmount.toString(), onTokenSellAmount.toString())

      // let bid = wmul(onTokenSellAmount.mul(BigNumber.from(10).pow(10)), onTokenPremium)
      // assert.equal(initialAuctionOrder.buyAmount.toString(), bid.toString())
    })

    it('reverts when calling before expiry', async function () {
      // "Controller: can not settle vault with un-expired onToken",
      const EXPECTED_ERROR = 'C25'

      const firstOptionAddress = firstOption.address

      await vault.connect(ownerSigner).commitAndClose()

      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      const firstTx = await vault.connect(keeperSigner).rollToNextOption()

      await expect(firstTx)
        .to.emit(vault, 'OpenShort')
        .withArgs(firstOptionAddress, depositedCollateralsAmounts, anyValue, keeper)

      // 100% of the vault's balance is allocated to short
      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), BigNumber.from(0))

      await expect(vault.connect(ownerSigner).commitAndClose()).to.be.revertedWith(EXPECTED_ERROR)
    })

    it('withdraws and roll funds into next option, after expiry ITM', async function () {
      const firstOptionAddress = firstOption.address
      const secondOptionAddress = secondOption.address

      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      const firstTx = await vault.connect(keeperSigner).rollToNextOption()

      assert.equal(await vault.currentOption(), firstOptionAddress)
      assert.bnEqual(await getCurrentOptionExpiry(), BigNumber.from(firstOption.expiry))

      await expect(firstTx)
        .to.emit(vault, 'OpenShort')
        .withArgs(firstOptionAddress, depositedCollateralsAmounts, anyValue, keeper)

      await time.increaseTo((await ethers.provider.getBlock('latest')).timestamp + auctionDuration)

      await gnosisAuction.connect(userSigner).settleAuction(await gnosisAuction.auctionCounter())

      const settlementPriceITM = isPut ? firstOptionStrike.sub(1) : firstOptionStrike.add(1)

      // withdraw 100% because it's OTM
      await setOracleExpiryPriceNeuron(
        params.underlying,
        oracle,
        settlementPriceITM,
        collateralAssetsOracles,
        await getCurrentOptionExpiry()
      )

      const beforeBalance = await neuronPool.balanceOf(collateralVault.address)

      await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike)

      const firstCloseTx = await vault.connect(ownerSigner).commitAndClose()
      const afterBalance = await neuronPool.balanceOf(collateralVault.address)

      const afterCollateralAmounts = [...depositedCollateralsAmounts]
      afterCollateralAmounts[0] = BigNumber.from(afterBalance).sub(beforeBalance)

      // test that the vault's balance decreased after closing short when ITM
      assert.isAbove(parseInt(depositAmount.toString()), parseInt(afterCollateralAmounts[0].toString()))

      await expect(firstCloseTx)
        .to.emit(vault, 'CloseShort')
        .withArgs(firstOptionAddress, afterCollateralAmounts, owner)

      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      const currBalance = await neuronPool.balanceOf(collateralVault.address)

      const secondDepositedCollateralsAmounts = new Array(collateralVaults.length).fill(BigNumber.from(0))
      secondDepositedCollateralsAmounts[0] = currBalance

      const secondTx = await vault.connect(keeperSigner).rollToNextOption()

      assert.equal(await vault.currentOption(), secondOptionAddress)
      assert.bnEqual(await getCurrentOptionExpiry(), BigNumber.from(secondOption.expiry))
      await expect(secondTx)
        .to.emit(vault, 'OpenShort')
        .withArgs(secondOptionAddress, secondDepositedCollateralsAmounts, anyValue, keeper)

      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), BigNumber.from(0))
    })

    it('withdraws and roll funds into next option, after expiry OTM', async function () {
      const firstOptionAddress = firstOption.address
      const secondOptionAddress = secondOption.address

      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      const firstTx = await vault.connect(keeperSigner).rollToNextOption()

      await expect(firstTx)
        .to.emit(vault, 'OpenShort')
        .withArgs(firstOptionAddress, depositedCollateralsAmounts, anyValue, keeper)

      let bidMultiplier = 1

      const auctionDetails = await bidForONToken(
        gnosisAuction,
        auctionBiddingTokenContract,
        userSigner.address,
        defaultONtokenAddress,
        firstOptionPremium,
        auctionBiddingTokenDecimals,
        bidMultiplier.toString(),
        auctionDuration
      )

      await gnosisAuction.connect(userSigner).settleAuction(auctionDetails[0])

      // Asset balance when auction closes only contains auction proceeds
      // Remaining vault's balance is still in Option Protocol Gamma Controller
      let auctionProceeds = await auctionBiddingTokenContract.balanceOf(vault.address)

      // only the premium should be left over because the funds are locked into Option Protocol
      assert.isAbove(
        parseInt((await auctionBiddingTokenContract.balanceOf(vault.address)).toString()),
        (parseInt(auctionProceeds.toString()) * 99) / 100
      )

      const settlementPriceOTM = isPut ? firstOptionStrike.add(1) : firstOptionStrike.sub(1)

      // withdraw 100% because it's OTM
      await setOracleExpiryPriceNeuron(
        params.underlying,
        oracle,
        settlementPriceOTM,
        collateralAssetsOracles,
        await getCurrentOptionExpiry()
      )

      const beforeBalance = await neuronPool.balanceOf(collateralVault.address)

      await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike)

      const firstCloseTx = await vault.connect(ownerSigner).commitAndClose()
      const firstCloseReceipt = await firstCloseTx.wait()

      const firstCloseCollateralVaultEvents = firstCloseReceipt.events
        .filter(x => x.address === collateralVault.address)
        .map(x => collateralVault.interface.parseLog(x))
      const firstClosePremiumSwapEvent = firstCloseCollateralVaultEvents.find(x => x.name === 'PremiumSwap')
      const firstClosePremiumInBidToken = firstClosePremiumSwapEvent.args[0]
      const firstClosePremiumInNeuronPoolToken = firstClosePremiumSwapEvent.args[1]
      assert.bnEqual(firstClosePremiumInBidToken, auctionProceeds)

      const afterCollateralAmounts = [...depositedCollateralsAmounts]
      const afterBalance = (await neuronPool.balanceOf(collateralVault.address)).sub(firstClosePremiumInNeuronPoolToken)
      afterCollateralAmounts[0] = BigNumber.from(afterBalance).sub(beforeBalance)

      await expect(firstCloseTx)
        .to.emit(vault, 'CloseShort')
        .withArgs(firstOptionAddress, afterCollateralAmounts, owner)

      // Time increase to after next option available
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      let pendingAmount = (await collateralVault.vaultState()).totalPending
      let [secondInitialLockedBalance, queuedWithdrawAmount] = await lockedBalanceForRollover(collateralVault)

      const secondInitialTotalBalance = await collateralVault.totalBalance()

      const secondTx = await vault.connect(keeperSigner).rollToNextOption()

      let vaultFees = secondInitialLockedBalance
        .add(queuedWithdrawAmount)
        .sub(pendingAmount)
        .mul(await collateralVault.managementFee())
        .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))

      vaultFees = vaultFees.add(
        secondInitialLockedBalance
          .add(queuedWithdrawAmount)
          .sub((await collateralVault.vaultState()).lastLockedAmount)
          .sub(pendingAmount)
          .mul(await collateralVault.performanceFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
      )

      const totalBalanceAfterFee = await collateralVault.totalBalance()

      assert.equal(secondInitialTotalBalance.sub(totalBalanceAfterFee).toString(), vaultFees.toString())

      assert.equal(await vault.currentOption(), secondOptionAddress)
      assert.bnEqual(await getCurrentOptionExpiry(), BigNumber.from(secondOption.expiry))

      const secondShortDepositAmount = depositAmount.add(firstClosePremiumInNeuronPoolToken).sub(vaultFees)
      const neuronPoolPricePerShare = await neuronPool.pricePerShare()
      const depositCollateralAmount = neuronPoolPricePerShare
        .mul(secondShortDepositAmount)
        .div(BigNumber.from(10).pow(18))
      const secondShortDepositedCollateralsAmounts = [
        depositCollateralAmount,
        ...depositedCollateralsAmounts.slice(-(depositedCollateralsAmounts.length - 1)),
      ]

      await expect(secondTx)
        .to.emit(vault, 'OpenShort')
        .withArgs(secondOptionAddress, secondShortDepositedCollateralsAmounts, anyValue, keeper)

      assert.bnEqual(await neuronPool.balanceOf(collateralVault.address), BigNumber.from(0))
    })

    it('withdraws and roll funds into next option, after expiry OTM (initiateWithdraw)', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, ownerSigner)
      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      await vault.connect(keeperSigner).rollToNextOption()

      await collateralVault.connect(ownerSigner).initiateWithdraw(params.depositAmount.div(2))
      // withdraw 100% because it's OTM
      await setOracleExpiryPriceNeuron(
        params.underlying,
        oracle,
        firstOptionStrike,
        collateralAssetsOracles,
        await getCurrentOptionExpiry()
      )
      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
      await vault.connect(keeperSigner).rollToNextOption()
      let [, queuedWithdrawAmountInitial] = await lockedBalanceForRollover(collateralVault)

      let bidMultiplier = 1

      const auctionDetails = await bidForONToken(
        gnosisAuction,
        auctionBiddingTokenContract,
        userSigner.address,
        await vault.currentOption(),
        (await vault.currentONtokenPremium()).mul(105).div(100),
        auctionBiddingTokenDecimals,
        bidMultiplier.toString(),
        auctionDuration
      )

      await gnosisAuction.connect(userSigner).settleAuction(auctionDetails[0])

      // only the premium should be left over because the funds are locked into Option Protocol
      assert.isAbove(
        parseInt((await auctionBiddingTokenContract.connect(userSigner).balanceOf(vault.address)).toString()),
        (parseInt(auctionDetails[2].toString()) * 99) / 100
      )

      const settlementPriceOTM = isPut ? firstOptionStrike.add(10000000000) : firstOptionStrike.sub(10000000000)

      // withdraw 100% because it's OTM
      await setOracleExpiryPriceNeuron(
        params.underlying,
        oracle,
        settlementPriceOTM,
        collateralAssetsOracles,
        await getCurrentOptionExpiry()
      )

      await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike)

      await collateralVault.connect(userSigner).initiateWithdraw(params.depositAmount.div(2))

      await vault.connect(ownerSigner).commitAndClose()

      // Time increase to after next option available
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      let pendingAmount = (await collateralVault.vaultState()).totalPending

      let [secondInitialLockedBalance, queuedWithdrawAmount] = await lockedBalanceForRollover(collateralVault)
      const secondInitialBalance = await collateralVault.totalBalance()

      await vault.connect(keeperSigner).rollToNextOption()

      let vaultFees = secondInitialLockedBalance
        .add(queuedWithdrawAmount.sub(queuedWithdrawAmountInitial))
        .sub(pendingAmount)
        .mul(await collateralVault.managementFee())
        .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))

      vaultFees = vaultFees.add(
        secondInitialLockedBalance
          .add(queuedWithdrawAmount.sub(queuedWithdrawAmountInitial))
          .sub((await collateralVault.vaultState()).lastLockedAmount)
          .sub(pendingAmount)
          .mul(await collateralVault.performanceFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
      )

      assert.bnEqual(vaultFees, secondInitialBalance.sub(await collateralVault.totalBalance()))
    })

    it('is not able to roll to new option consecutively without setNextOption', async function () {
      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      await vault.connect(keeperSigner).rollToNextOption()

      await expect(vault.connect(keeperSigner).rollToNextOption()).to.be.revertedWith('!nextOption')
    })

    it('does not debit the user on first deposit', async () => {
      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      // totalBalance should remain the same before and after roll
      const startBalance = await collateralVault.totalBalance()

      await vault.connect(keeperSigner).rollToNextOption()

      assert.bnEqual(await collateralVault.totalBalance(), startBalance)
      assert.bnEqual(await collateralVault.accountVaultBalance(user), depositAmount)

      // simulate a profit by transferring some tokens
      await depositToNeuronPool(neuronPool, userSigner, BigNumber.from(1))
      await neuronPool.connect(userSigner).transfer(collateralVault.address, BigNumber.from(1))

      // totalBalance should remain the same before and after roll
      const secondStartBalance = await collateralVault.totalBalance()

      await rollToSecondOption(firstOptionStrike)

      // After the first round, the user is charged the fee
      assert.bnLt(await collateralVault.totalBalance(), secondStartBalance)
      assert.bnLt(await collateralVault.accountVaultBalance(user), depositAmount)
    })
  }
})
