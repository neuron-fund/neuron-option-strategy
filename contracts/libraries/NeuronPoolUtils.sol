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

library NeuronPoolUtils {
    using SafeMath for uint256;
    using SupportsNonCompliantERC20 for IERC20;
    using SafeERC20 for IERC20;

    /**
     * @notice Unwraps the necessary amount of the yield-bearing yearn token
     *         and transfers amount to vault
     * @param amount is the amount of `asset` to withdraw
     * @param asset is asset to unwrap to
     * @param neuronPoolAddress is the address of the collateral token
     */
    function unwrapNeuronPool(
        uint256 amount,
        address asset,
        address neuronPoolAddress
    ) public returns (uint256 unwrappedAssetAmount) {
        INeuronPool neuronPool = INeuronPool(neuronPoolAddress);
        uint256 assetBalanceBefore = IERC20(asset).balanceOf(address(this));
        neuronPool.withdraw(asset, amount);
        uint256 assetBalanceAfter = IERC20(asset).balanceOf(address(this));

        return assetBalanceAfter - assetBalanceBefore;
    }

    function unwrapAndWithdraw(
        address weth,
        address neuronPool,
        uint256 amountToUnwrap,
        address to
    ) external {
        address unwrapToAsset = INeuronPool(neuronPool).token();
        uint256 unwrappedAssetAmount = unwrapNeuronPool(amountToUnwrap, unwrapToAsset, neuronPool);

        transferAsset(weth, unwrapToAsset, to, unwrappedAssetAmount);
    }

    /**
     * @notice Wraps the necessary amount of the base token to the yield-bearing yearn token
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     */
    function wrapToNeuronPool(address asset, address collateralToken) external {
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
