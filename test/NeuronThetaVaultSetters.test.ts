import { expect } from 'chai'
import { BigNumber, constants } from 'ethers'
import * as time from '../helpers/time'
import { assert } from '../helpers/assertions'
import { FEE_SCALING, initiateVault, VaultTestParams, WEEKS_PER_YEAR } from '../helpers/vault'
import { NeuronEthThetaVaultCallTestParams } from '../helpers/testParams'
import { parseEther, parseUnits } from 'ethers/lib/utils'
import { depositToNeuronPool } from '../helpers/neuronPool'
import { CHAINID } from '../constants/constants'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#setters', async function (params) {
  const {
    owner,
    keeper,
    strikeSelection,
    optionsPremiumPricer,
    vault,
    ownerSigner,
    userSigner,
    user,
    collateralVaults,
    tokenDecimals,
    collateralAssetsContracts,
  } = params

  const collateralVault = collateralVaults[0]

  return () => {
    it('set new keeper to owner', async function () {
      assert.equal(await vault.keeper(), keeper)
      await vault.connect(ownerSigner).setNewKeeper(owner)
      assert.equal(await vault.keeper(), owner)
    })

    it('reverts when not owner call', async function () {
      await expect(vault.setNewKeeper(owner)).to.be.revertedWith('caller is not the owner')
    })

    it('set new strike selection contract to owner', async function () {
      assert.equal(await vault.strikeSelection(), strikeSelection.address)
      await vault.connect(ownerSigner).setStrikeSelection(owner)
      assert.equal(await vault.strikeSelection(), owner)
    })

    it('reverts when not owner call', async function () {
      await expect(vault.setStrikeSelection(owner)).to.be.revertedWith('caller is not the owner')
    })

    it('set new options premium pricer contract to owner', async function () {
      assert.equal(await vault.optionsPremiumPricer(), optionsPremiumPricer.address)
      await vault.connect(ownerSigner).setOptionsPremiumPricer(owner)
      assert.equal(await vault.optionsPremiumPricer(), owner)
    })

    it('reverts when not owner call', async function () {
      await expect(vault.setOptionsPremiumPricer(owner)).to.be.revertedWith('caller is not the owner')
    })

    it('reverts when setting 0x0 as feeRecipient', async function () {
      await expect(vault.connect(ownerSigner).setFeeRecipient(constants.AddressZero)).to.be.revertedWith(
        '!newFeeRecipient'
      )
    })

    it('reverts when not owner call', async function () {
      await expect(vault.setFeeRecipient(owner)).to.be.revertedWith('caller is not the owner')
    })

    it('changes the fee recipient', async function () {
      await vault.connect(ownerSigner).setFeeRecipient(owner)
      assert.equal(await vault.feeRecipient(), owner)
    })

    it('setManagementFee to 0', async function () {
      await vault.connect(ownerSigner).setManagementFee(0)
      assert.bnEqual(await vault.managementFee(), BigNumber.from(0))
    })

    it('reverts when not owner call', async function () {
      await expect(vault.setManagementFee(BigNumber.from('1000000').toString())).to.be.revertedWith(
        'caller is not the owner'
      )
    })

    it('changes the management fee', async function () {
      await vault.connect(ownerSigner).setManagementFee(BigNumber.from('1000000').toString())
      assert.equal(
        (await vault.managementFee()).toString(),
        BigNumber.from(1000000).mul(FEE_SCALING).div(WEEKS_PER_YEAR).toString()
      )
    })

    it('setPerformanceFee to 0', async function () {
      await vault.connect(ownerSigner).setPerformanceFee(0)
      assert.bnEqual(await vault.performanceFee(), BigNumber.from(0))
    })

    it('reverts when not owner call', async function () {
      await expect(vault.setPerformanceFee(BigNumber.from('1000000').toString())).to.be.revertedWith(
        'caller is not the owner'
      )
    })

    it('changes the performance fee', async function () {
      await vault.connect(ownerSigner).setPerformanceFee(BigNumber.from('1000000').toString())
      assert.equal((await vault.performanceFee()).toString(), BigNumber.from('1000000').toString())
    })

    it('reverts when setting 10 seconds to setAuctionDuration', async function () {
      await expect(vault.connect(ownerSigner).setAuctionDuration('10')).to.be.revertedWith('Invalid auction duration')
    })

    it('reverts when not owner call', async function () {
      await expect(vault.setAuctionDuration(BigNumber.from('10').toString())).to.be.revertedWith(
        'caller is not the owner'
      )
    })

    it('changes the auction duration', async function () {
      await vault.connect(ownerSigner).setAuctionDuration('1000000')
      assert.equal((await vault.auctionDuration()).toString(), '1000000')
    })

    it('should revert if not owner', async function () {
      await expect(vault.connect(userSigner).setStrikePrice(parseEther('10'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('should set the new strike price', async function () {
      await vault.connect(ownerSigner).setStrikePrice(parseEther('10'))
      assert.bnEqual(BigNumber.from(await vault.overriddenStrikePrice()), parseEther('10'))
    })

    it('should revert if not owner', async function () {
      await expect(collateralVault.connect(userSigner).setCap(parseEther('10'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )
    })

    it('should set the new cap', async function () {
      const tx = await collateralVault.connect(ownerSigner).setCap(parseEther('10'))
      assert.equal((await collateralVault.cap()).toString(), parseEther('10').toString())
      await expect(tx)
        .to.emit(collateralVault, 'CapSet')
        .withArgs(parseUnits('500', tokenDecimals > 18 ? tokenDecimals : 18), parseEther('10'))
    })

    it('should revert when depositing over the cap', async function () {
      const capAmount = BigNumber.from('100000000')
      const depositAmount = BigNumber.from('10000000000')
      const collateralVault = collateralVaults[0]
      const neuronPool = collateralAssetsContracts[0]
      await collateralVault.connect(ownerSigner).setCap(capAmount)

      await depositToNeuronPool(CHAINID.ETH_MAINNET, neuronPool, userSigner, depositAmount)
      const collateralBalanceStarted = await neuronPool.connect(userSigner).balanceOf(user)
      const neuronPoolPricePerShare = await neuronPool.connect(userSigner).pricePerShare()
      const withdrawAmount = neuronPoolPricePerShare.mul(collateralBalanceStarted).div(BigNumber.from(10).pow(18))
      assert.bnEqual(withdrawAmount, depositAmount, 'Collateral withdraw amount is not equal to deposit amount')
      await neuronPool.connect(userSigner).approve(collateralVault.address, collateralBalanceStarted)
      await expect(
        collateralVault.connect(userSigner).deposit(collateralBalanceStarted, neuronPool.address)
      ).to.be.revertedWith('Exceed cap')
    })
  }
})
