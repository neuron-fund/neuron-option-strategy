import { CHAINID } from '../constants/constants'
import { depositToNeuronPool } from '../helpers/neuronPool'
import { BigNumber } from '@ethersproject/bignumber'
import { assert } from '../helpers/assertions'
import { expect } from 'chai'
import { WETH } from '../constants/externalAddresses'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#depositETH', async function (params) {
  const { collateralVaults, userSigner, user, collateralAssetsContracts, collateralAssetsAddresses } = params

  return () => {
    if (params.collateralUnwrappedAsset === WETH) {
      // TODO deposit ETH for collateralVault
      it('creates pending deposit successfully', async function () {
        const depositAmount = params.depositAmount
        const collateralVault = collateralVaults[0]
        const neuronPool = collateralAssetsContracts[0]
        await depositToNeuronPool(neuronPool, userSigner, depositAmount)
        const collateralBalanceStarted = await neuronPool.connect(userSigner).balanceOf(user)
        const neuronPoolPricePerShare = await neuronPool.connect(userSigner).pricePerShare()
        const withdrawAmount = neuronPoolPricePerShare.mul(collateralBalanceStarted).div(BigNumber.from(10).pow(18))
        assert.bnEqual(withdrawAmount, depositAmount, 'Collateral withdraw amount is not equal to deposit amount')
        await neuronPool.connect(userSigner).approve(collateralVault.address, collateralBalanceStarted)
        const tx = await collateralVault.connect(userSigner).deposit(collateralBalanceStarted, neuronPool.address)

        // Unchanged for share balance and totalSupply
        assert.bnEqual(await collateralVault.totalSupply(), BigNumber.from(0))
        assert.bnEqual(await collateralVault.balanceOf(user), BigNumber.from(0))
        await expect(tx).to.emit(collateralVault, 'Deposit').withArgs(user, collateralBalanceStarted, 1)
        await expect(tx).to.emit(collateralVault, 'Deposit').withArgs(user, collateralBalanceStarted, 1)

        assert.bnEqual(await collateralVault.totalPending(), collateralBalanceStarted)
        const { round, amount } = await collateralVault.depositReceipts(user)
        assert.equal(round, 1)
        assert.bnEqual(amount, collateralBalanceStarted)
      })

      it('reverts when no value passed', async function () {
        const collateralVault = collateralVaults[0]
        await expect(collateralVault.connect(userSigner).deposit(0, collateralAssetsAddresses[0])).to.be.revertedWith(
          '!amount'
        )
      })

      it('does not inflate the share tokens on initialization', async function () {
        const depositAmount = params.depositAmount
        const collateralVault = collateralVaults[0]
        const neuronPool = collateralAssetsContracts[0]
        await depositToNeuronPool(neuronPool, userSigner, depositAmount)
        const collateralBalanceStarted = await neuronPool.connect(userSigner).balanceOf(user)
        const neuronPoolPricePerShare = await neuronPool.connect(userSigner).pricePerShare()
        const withdrawAmount = neuronPoolPricePerShare.mul(collateralBalanceStarted).div(BigNumber.from(10).pow(18))
        assert.bnEqual(withdrawAmount, depositAmount, 'Collateral withdraw amount is not equal to deposit amount')
        await neuronPool.connect(userSigner).approve(collateralVault.address, collateralBalanceStarted)
        await collateralVault.connect(userSigner).deposit(collateralBalanceStarted, neuronPool.address)

        assert.isTrue((await collateralVault.balanceOf(user)).isZero())
      })

      it('reverts when minimum shares are not minted', async function () {
        const depositAmount = params.depositAmount
        const collateralVault = collateralVaults[0]
        const neuronPool = collateralAssetsContracts[0]
        await depositToNeuronPool(neuronPool, userSigner, depositAmount)
        const collateralBalanceStarted = await neuronPool.connect(userSigner).balanceOf(user)
        const neuronPoolPricePerShare = await neuronPool.connect(userSigner).pricePerShare()
        const withdrawAmount = neuronPoolPricePerShare.mul(collateralBalanceStarted).div(BigNumber.from(10).pow(18))
        assert.bnEqual(withdrawAmount, depositAmount, 'Collateral withdraw amount is not equal to deposit amount')
        await neuronPool.connect(userSigner).approve(collateralVault.address, collateralBalanceStarted)

        await expect(
          collateralVault
            .connect(userSigner)
            .deposit(BigNumber.from('10').pow('10').sub(BigNumber.from('1')), neuronPool.address)
        ).to.be.revertedWith('Insufficient balance')
      })
    } else {
      // it('reverts when asset is not WETH', async function () {
      //   const depositAmount = parseEther('1')
      //   await expect(vault.depositETH({ value: depositAmount })).to.be.revertedWith('!WETH')
      // })
    }
  }
})
