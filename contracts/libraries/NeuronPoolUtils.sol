// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INeuronPool} from "../interfaces/INeuronPool.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {SupportsNonCompliantERC20} from "./SupportsNonCompliantERC20.sol";

import "hardhat/console.sol";

library NeuronPoolUtils {
    using SafeMath for uint256;
    using SupportsNonCompliantERC20 for IERC20;
    using SafeERC20 for IERC20;

    /**
     * @notice Withdraws yvWETH + WETH (if necessary) from vault using vault shares
     * @param weth is the weth address
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     * @param recipient is the recipient
     * @param amount is the withdraw amount in `asset`
     * @return withdrawAmount is the withdraw amount in `collateralToken`
     */
    function withdrawYieldAndBaseToken(
        address weth,
        address asset,
        address collateralToken,
        address recipient,
        uint256 amount
    ) external returns (uint256) {
        uint256 pricePerShare = INeuronPool(collateralToken).pricePerShare();
        uint256 withdrawAmount = DSMath.wdiv(amount, pricePerShare.mul(decimalShift(collateralToken)));
        uint256 yieldTokenBalance = withdrawYieldToken(collateralToken, recipient, withdrawAmount);

        // If there is not enough yvWETH in the vault, it withdraws as much as possible and
        // transfers the rest in `asset`
        if (withdrawAmount > yieldTokenBalance) {
            withdrawBaseToken(
                weth,
                asset,
                collateralToken,
                recipient,
                withdrawAmount,
                yieldTokenBalance,
                pricePerShare
            );
        }

        return withdrawAmount;
    }

    /**
     * @notice Withdraws yvWETH from vault
     * @param collateralToken is the address of the collateral token
     * @param recipient is the recipient
     * @param withdrawAmount is the withdraw amount in terms of yearn tokens
     * @return yieldTokenBalance is the balance of the yield token
     */
    function withdrawYieldToken(
        address collateralToken,
        address recipient,
        uint256 withdrawAmount
    ) internal returns (uint256) {
        IERC20 collateral = IERC20(collateralToken);

        uint256 yieldTokenBalance = collateral.balanceOf(address(this));
        uint256 yieldTokensToWithdraw = DSMath.min(yieldTokenBalance, withdrawAmount);
        if (yieldTokensToWithdraw > 0) {
            collateral.safeTransfer(recipient, yieldTokensToWithdraw);
        }

        return yieldTokenBalance;
    }

    /**
     * @notice Withdraws `asset` from vault
     * @param weth is the weth address
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     * @param recipient is the recipient
     * @param withdrawAmount is the withdraw amount in terms of yearn tokens
     * @param yieldTokenBalance is the collateral token (yvWETH) balance of the vault
     * @param pricePerShare is the yvWETH<->WETH price ratio
     */
    function withdrawBaseToken(
        address weth,
        address asset,
        address collateralToken,
        address recipient,
        uint256 withdrawAmount,
        uint256 yieldTokenBalance,
        uint256 pricePerShare
    ) internal {
        uint256 underlyingTokensToWithdraw = DSMath.wmul(
            withdrawAmount.sub(yieldTokenBalance),
            pricePerShare.mul(decimalShift(collateralToken))
        );
        transferAsset(weth, asset, payable(recipient), underlyingTokensToWithdraw);
    }

    /**
     * @notice Unwraps the necessary amount of the yield-bearing yearn token
     *         and transfers amount to vault
     * @param amount is the amount of `asset` to withdraw
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     */
    function unwrapYieldToken(
        uint256 amount,
        address asset,
        address collateralToken
    ) external {
        uint256 assetBalance = IERC20(asset).balanceOf(address(this));
        INeuronPool collateral = INeuronPool(collateralToken);

        uint256 amountToUnwrap = DSMath.wdiv(
            DSMath.max(assetBalance, amount).sub(assetBalance),
            collateral.pricePerShare().mul(decimalShift(collateralToken))
        );

        if (amountToUnwrap > 0) {
            collateral.withdraw(asset, amountToUnwrap);
        }
    }

    /**
     * @notice Wraps the necessary amount of the base token to the yield-bearing yearn token
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     */
    function wrapToYieldToken(address asset, address collateralToken) external {
        uint256 amountToWrap = IERC20(asset).balanceOf(address(this));

        if (amountToWrap > 0) {
            IERC20(asset).safeApprove(collateralToken, amountToWrap);

            // there is a slight imprecision with regards to calculating back from yearn token -> underlying
            // that stems from miscoordination between ytoken .deposit() amount wrapped and pricePerShare
            // at that point in time.
            // ex: if I have 1 eth, deposit 1 eth into yearn vault and calculate value of yearn token balance
            // denominated in eth (via balance(yearn token) * pricePerShare) we will get 1 eth - 1 wei.
            INeuronPool(collateralToken).deposit(asset, amountToWrap);
        }
    }

    /**
     * @notice Helper function to make either an ETH transfer or ERC20 transfer
     * @param weth is the weth address
     * @param asset is the vault asset address
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(
        address weth,
        address asset,
        address recipient,
        uint256 amount
    ) public {
        if (amount == 0) {
            return;
        }
        if (asset == weth) {
            IWETH(weth).withdraw(amount);
            (bool success, ) = payable(recipient).call{value: amount}("");
            require(success, "!success");
            return;
        }
        console.log("recipient", recipient);
        IERC20(asset).safeTransfer(recipient, amount);
    }

    /**
     * @notice Returns the decimal shift between 18 decimals and asset tokens
     * @param collateralToken is the address of the collateral token
     */
    function decimalShift(address collateralToken) public view returns (uint256) {
        return 10**(uint256(18).sub(IERC20Detailed(collateralToken).decimals()));
    }
}
