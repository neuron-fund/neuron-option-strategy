import * as time from '../helpers/time'
import { OPTION_DELAY } from '../helpers/vault'
import { BigNumber } from '@ethersproject/bignumber'
import { assert } from '../helpers/assertions'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { CHAINID, GAMMA_CONTROLLER } from '../constants/constants'
import { ethers } from 'hardhat'
import { constants } from 'ethers'
import { WETH } from '../constants/externalAddresses'
import { convertPriceAmount } from '../helpers/utils'
import { getAsset } from '../helpers/funds'
import { wmul } from '../helpers/math'
import { runVaultTests } from '../helpers/runVaultTests'

const { getContractAt } = ethers

runVaultTests('#commitAndClose', async function (params) {
  const {
    userSigner,
    ownerSigner,
    collateralVaults,
    collateralAssetsContracts,
    rollToNextOption,
    rollToSecondOption,
    defaultONtokenAddress,
    vault,
    owner,
    auctionBiddingTokenContract,
    premiumCalcToken,
    gnosisAuction,
    firstOptionPremium,
    auctionDuration,
    keeperSigner,
    firstOption,
    optionsPremiumPricer,
  } = params
  const provider = ethers.provider
  console.log('IN COMMIT AND CLOSE')

  return () => {
    console.log('IN COMMIT AND CLOSE RETURN')
    it('sets the next option and closes existing short', async function () {
      console.log('IN COMMIT AND CLOSE sets the next option and closes existing short')
      const depositAmount = params.depositAmount
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]
      console.log('BEFORE DEPOSIT INTO COLLATERAL')
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)
      console.log('AFTE DEPOSIT INTO COLLATERAL')

      const res = await vault.connect(ownerSigner).commitAndClose({ from: owner })

      const receipt = await res.wait()
      const block = await provider.getBlock(receipt.blockNumber)

      const optionState = await vault.optionState()
      const vaultState = await vault.vaultState()

      assert.equal(optionState.currentOption, constants.AddressZero)
      assert.equal(optionState.nextOption, defaultONtokenAddress)
      assert.equal(optionState.nextOptionReadyAt, block.timestamp + OPTION_DELAY)
      assert.isTrue(vaultState.lockedAmount.isZero())
      assert.equal(optionState.currentOption, constants.AddressZero)
    })

    it('should set the next option twice', async function () {
      const depositAmount = params.depositAmount
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]

      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await vault.connect(ownerSigner).commitAndClose()
      await vault.connect(ownerSigner).commitAndClose()
    })

    it('sets the correct strike when overriding strike price', async function () {
      const WETH_STRIKE_PRICE = {
        [CHAINID.ETH_MAINNET]: 250000000000, // WETH
      }

      const altStrikePrice = '405000000000'
      const newStrikePrice = params.underlying === WETH ? WETH_STRIKE_PRICE[CHAINID.ETH_MAINNET] : altStrikePrice

      await vault.connect(ownerSigner).setStrikePrice(newStrikePrice)

      assert.equal((await vault.lastStrikeOverrideRound()).toString(), '1')
      assert.equal((await vault.overriddenStrikePrice()).toString(), newStrikePrice.toString())

      await vault.connect(ownerSigner).commitAndClose({ from: owner })

      assert.equal(
        (await (await getContractAt('IONtoken', await vault.nextOption())).strikePrice()).toString(),
        newStrikePrice.toString()
      )

      const expiryTimestampOfNewOption = await (
        await getContractAt('IONtoken', await vault.nextOption())
      ).expiryTimestamp()

      let expectedPremium = (
        await optionsPremiumPricer.getPremium(newStrikePrice, expiryTimestampOfNewOption, params.isPut)
      )
        .mul(await vault.premiumDiscount())
        .div(1000)

      if (auctionBiddingTokenContract.address !== premiumCalcToken) {
        expectedPremium = await convertPriceAmount(
          premiumCalcToken,
          auctionBiddingTokenContract.address,
          expectedPremium,
          userSigner
        )
      }

      assert.bnEqual(await vault.currentONtokenPremium(), expectedPremium)
    })

    it('closes short even when onTokens are burned', async function () {
      const depositAmount = params.depositAmount
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]

      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await time.increase(auctionDuration)

      // auction settled without any bids
      // so we return 100% of the tokens
      await gnosisAuction.connect(userSigner).settleAuction(await vault.optionAuctionID())

      await vault.connect(keeperSigner).burnRemainingONTokens()

      await rollToSecondOption(firstOption.strikePrice)

      const controller = await ethers.getContractAt('IController', GAMMA_CONTROLLER[CHAINID.ETH_MAINNET])

      assert.bnEqual(await controller.accountVaultCounter(vault.address), BigNumber.from(2))
    })

    it('closes short when onTokens are partially burned', async function () {
      const depositAmount = params.depositAmount
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]

      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      const bidMultiplier = '1'
      const latestAuction = (await gnosisAuction.auctionCounter()).toString()
      const onToken = await ethers.getContractAt('IERC20', firstOption.address)
      const initialONtokenBalance = await onToken.balanceOf(gnosisAuction.address)

      const totalOptionsAvailableToBuy = initialONtokenBalance
        .div(2)
        .mul(await gnosisAuction.FEE_DENOMINATOR())
        .div((await gnosisAuction.FEE_DENOMINATOR()).add(await gnosisAuction.feeNumerator()))
        .div(bidMultiplier)

      let bid = wmul(totalOptionsAvailableToBuy.mul(BigNumber.from(10).pow(10)), firstOptionPremium)

      const queueStartElement = '0x0000000000000000000000000000000000000000000000000000000000000001'
      await getAsset(CHAINID.ETH_MAINNET, auctionBiddingTokenContract.address, bid, userSigner.address)
      await auctionBiddingTokenContract.connect(userSigner).approve(gnosisAuction.address, bid.toString())

      // BID ON_TOKENS HERE
      await gnosisAuction
        .connect(userSigner)
        .placeSellOrders(
          latestAuction,
          [totalOptionsAvailableToBuy.toString()],
          [bid.toString()],
          [queueStartElement],
          '0x'
        )

      await time.increase(auctionDuration)

      // we initiate a complete burn of the onTokens
      await gnosisAuction.connect(userSigner).settleAuction(await vault.optionAuctionID())

      assert.bnLte(await onToken.balanceOf(vault.address), initialONtokenBalance.div(2))

      await vault.connect(keeperSigner).burnRemainingONTokens()

      await rollToSecondOption(firstOption.strikePrice)
    })
  }
})
