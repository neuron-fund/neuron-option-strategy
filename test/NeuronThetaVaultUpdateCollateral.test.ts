import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { assert } from '../helpers/assertions'
import { deployNeuronCollateralVault, depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'
import { setOracleExpiryPriceNeuron, setupOracle, whitelistProduct } from '../helpers/utils'
import * as time from '../helpers/time'
import { deployments, ethers } from 'hardhat'
import { IONtoken__factory } from '../typechain-types'
import { depositToNeuronPool } from '../helpers/neuronPool'

runVaultTests('#updateCollateral', async function (params) {
  const {
    user,
    userSigner,
    ownerSigner,
    collateralVaults,
    collateralAssetsContracts,
    firstOptionStrike,
    rollToNextOption,
    depositAmount,
    collateralAssetsOracles,
    vault,
    secondOptionStrike,
    getCurrentOptionExpiry,
    keeperSigner,
    underlying,
    owner,
    keeper,
    feeRecipient,
    managementFee,
    performanceFee,
    tokenDecimals,
    tokenName,
    tokenSymbol,
    adminSigner,
    marginPoolAddress,
    isPut,
    minimumSupply,
    collateralVaultLifecycleLib,
    neuronPoolUtilsLib,
    firstOption,
    auctionDuration,
    gnosisAuction,
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

  const newNeuronPoolName = 'NeuronPoolStabilityPoolLUSD'
  const newNeuronPoolPricerName = 'NeuronPoolCurveLUSDPricer'

  const {
    collateralVault: newCollateralVault,
    neuronPool: newNeuronPool,
    neuronPoolPricer: newNeuronPoolPricer,
  } = await deployNeuronCollateralVault({
    neuronPoolName: newNeuronPoolName,
    ownerSigner,
    owner,
    keeper,
    keeperSigner,
    feeRecipient,
    managementFee,
    performanceFee,
    tokenName,
    tokenSymbol,
    isPut,
    tokenDecimals,
    underlying,
    minimumSupply,
    neuronPoolPricerName: newNeuronPoolPricerName,
    adminSigner,
    collateralVaultCap: params.collateralVaultCap,
    collateralVaultLifecycleLib,
    neuronPoolUtilsLib,
  })
  await newCollateralVault.connect(ownerSigner).setNewKeeper(vault.address)

  const newCollateralVaultsAddresses = collateralVaults.map(x => x.address)
  newCollateralVaultsAddresses[0] = newCollateralVault.address

  const newCollateralAssets = [...collateralAssetsContracts]
  newCollateralAssets[0] = newNeuronPool

  const newCollateralAssetsOracles = [...collateralAssetsOracles]
  newCollateralAssetsOracles[0] = newNeuronPoolPricer

  await whitelistProduct(
    params.underlying,
    params.strikeAsset,
    newCollateralAssets.map(x => x.address),
    params.isPut
  )

  return () => {
    it('new option has new collateral', async function () {
      const firstOptionAddress = firstOption.address

      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      await vault.connect(keeperSigner).rollToNextOption()

      assert.equal(await vault.currentOption(), firstOptionAddress)

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

      await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike)

      await vault.connect(ownerSigner).queueCollateralUpdate({
        newCollateralAssets: newCollateralAssets.map(x => x.address),
        newCollateralVaults: newCollateralVaultsAddresses,
      })

      await vault.connect(ownerSigner).commitAndClose()

      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
      await depositIntoCollateralVault(newCollateralVault, newNeuronPool, depositAmount, userSigner)
      await vault.connect(keeperSigner).rollToNextOption()

      const currentOptionAddress = await vault.currentOption()

      const currentOption = IONtoken__factory.connect(currentOptionAddress, ownerSigner)
      const currentOptionCollateral = await currentOption.getCollateralAssets()

      assert.equal(currentOptionCollateral[0], newNeuronPool.address)
    })

    it(`can't deposit to disabled vault`, async function () {
      const firstOptionAddress = firstOption.address

      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      await vault.connect(keeperSigner).rollToNextOption()

      assert.equal(await vault.currentOption(), firstOptionAddress)

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

      await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike)

      await vault.connect(ownerSigner).queueCollateralUpdate({
        newCollateralAssets: newCollateralAssets.map(x => x.address),
        newCollateralVaults: newCollateralVaultsAddresses,
      })

      await vault.connect(ownerSigner).commitAndClose()

      await collateralVault.connect(ownerSigner).disableVault()

      await depositToNeuronPool(neuronPool, userSigner, depositAmount)
      await neuronPool.connect(userSigner).approve(collateralVault.address, depositAmount)
      await expect(collateralVault.connect(userSigner).deposit(depositAmount, neuronPool.address)).to.be.revertedWith(
        'vault is disabled'
      )
    })

    it(`can't disable while on round`, async function () {
      const firstOptionAddress = firstOption.address

      await vault.connect(ownerSigner).commitAndClose()
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)

      await vault.connect(keeperSigner).rollToNextOption()

      assert.equal(await vault.currentOption(), firstOptionAddress)

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

      await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike)

      await vault.connect(ownerSigner).queueCollateralUpdate({
        newCollateralAssets: newCollateralAssets.map(x => x.address),
        newCollateralVaults: newCollateralVaultsAddresses,
      })

      await expect(collateralVault.connect(ownerSigner).disableVault()).to.be.revertedWith('lockedAmount != 0')
    })

    // TODO withdraw from disabled vault
  }
})
