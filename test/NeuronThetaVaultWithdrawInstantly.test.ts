import { expect } from 'chai'
import { depositIntoCollateralVault } from '../helpers/neuronCollateralVault'
import { runVaultTests } from '../helpers/runVaultTests'

runVaultTests('#withdrawInstantly', async function (params) {
  const { userSigner, collateralVaults, collateralAssetsContracts, rollToNextOption } = params
  const depositAmount = params.depositAmount
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]

  return () => {
    it('reverts with 0 amount', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await expect(collateralVault.connect(userSigner).withdrawInstantly(0)).to.be.revertedWith('!amount')
    })

    it('reverts when withdrawing more than available', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await expect(collateralVault.connect(userSigner).withdrawInstantly(depositAmount.add(1))).to.be.revertedWith(
        'Exceed amount'
      )
    })

    it('reverts when deposit receipt is processed', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await collateralVault.connect(userSigner).maxRedeem()

      await expect(collateralVault.connect(userSigner).withdrawInstantly(depositAmount.add(1))).to.be.revertedWith(
        'Invalid round'
      )
    })

    it('reverts when withdrawing next round', async function () {
      await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

      await rollToNextOption()

      await expect(collateralVault.connect(userSigner).withdrawInstantly(depositAmount.add(1))).to.be.revertedWith(
        'Invalid round'
      )
    })

    // TODO neuron
    // it('withdraws the amount in deposit receipt', async function () {
    //   const collateralVault = collateralVaults[0]
    //   const neuronPool = collateralAssetsContracts[0]
    //   await depositIntoCollateralVault(collateralVault, neuronPool, depositAmount, userSigner)

    //   let startBalance: BigNumber
    //   let withdrawAmount: BigNumber
    //   startBalance = await assetContract.balanceOf(user)

    //   const tx = await collateralVault.connect(userSigner).withdrawInstantly(depositAmount)
    //   const receipt = await tx.wait()

    //   const endBalance = await assetContract.balanceOf(user)
    //   withdrawAmount = endBalance.sub(startBalance)
    //   assert.bnEqual(withdrawAmount, depositAmount)

    //   await expect(tx).to.emit(collateralVault, 'InstantWithdraw').withArgs(user, depositAmount, 1)

    //   const { round, amount } = await collateralVault.connect(userSigner).depositReceipts(user)
    //   assert.equal(round, 1)
    //   assert.bnEqual(amount, BigNumber.from(0))

    //   // Should decrement the pending amounts
    //   assert.bnEqual(await collateralVault.totalPending(), BigNumber.from(0))
    // })
  }
})
