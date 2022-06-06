// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapRouterV2} from "../interfaces/IUniswapRouterV2.sol";
import "./Path.sol";

import "hardhat/console.sol";

library UniswapRouter {
    using Path for bytes;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * @notice Swaps assets by calling UniswapV3 router
     * @param recipient is the address of recipient of the tokenOut
     * @param tokenIn is the address of the token given to the router
     * @param tokenOut is the address of the token output from the router
     * @param amountIn is the amount of tokenIn given to the router
     * @param minAmountOut is the minimum acceptable amount of tokenOut received from swap
     * @param router is the contract address of UniswapV3 router
     * @param weth token address of WETH
     */
    function swap(
        address recipient,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address router,
        address weth
    ) internal returns (uint256) {
        // Approve router to spend tokenIn
        IERC20(tokenIn).safeApprove(router, 0);
        IERC20(tokenIn).safeApprove(router, amountIn);
        require(tokenIn != address(0), "swap !tokenIn");
        require(tokenOut != address(0), "swap !tokenOut");
        require(router != address(0), "swap !router");

        address[] memory path;

        if (tokenIn == weth || tokenOut == weth) {
            path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
        } else {
            path = new address[](3);
            path[0] = tokenIn;
            path[1] = weth;
            path[2] = tokenOut;
            console.log(")internalreturns ~ path[2]", path[2]);
        }
        console.log(")internalreturns ~ path[0]", path[0]);
        console.log(")internalreturns ~ path[1]", path[1]);

        uint256 amountBefore = IERC20(tokenOut).balanceOf(recipient);

        console.log(")internalreturns ~ minAmountOut", minAmountOut);
        console.log(")internalreturns ~ amountIn", amountIn);
        console.log("IERC20(tokenIn).allowence", IERC20(tokenIn).allowance(address(this), router));
        console.log(")internalreturns ~ recipient", recipient);
        console.log(")internalreturns ~ address(this)", address(this));
        IUniswapRouterV2(router).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            recipient,
            block.timestamp.add(60)
        );
        console.log("swapExactTokensForTokens after");
        uint256 amountAfter = IERC20(tokenOut).balanceOf(recipient);
        console.log(")internalreturns ~ amountAfter", amountAfter);

        return amountAfter.sub(amountBefore);
    }
}
