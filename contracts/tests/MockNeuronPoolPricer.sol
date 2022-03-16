// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {GammaOracleInterface} from "../interfaces/GammaOracleInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {MockNeuronPool} from "./MockNeuronPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @notice A Pricer contract for a Yearn nToken
 */
contract MockNeuronPoolPricer {
    using SafeMath for uint256;

    /// @notice oracle address
    GammaOracleInterface public oracle;

    /// @notice nToken that this pricer will a get price for
    MockNeuronPool public nToken;

    /// @notice underlying asset for this nToken
    IERC20Detailed public underlying;

    /**
     * @param _nToken nToken asset
     * @param _underlying underlying asset for this nToken
     * @param _oracle Oracle contract address
     */
    constructor(
        address _nToken,
        address _underlying,
        address _oracle
    ) {
        require(_nToken != address(0), "MockNeuronPoolPricer: nToken address can not be 0");
        require(_underlying != address(0), "MockNeuronPoolPricer: underlying address can not be 0");
        require(_oracle != address(0), "MockNeuronPoolPricer: oracle address can not be 0");

        nToken = MockNeuronPool(_nToken);
        underlying = IERC20Detailed(_underlying);
        oracle = GammaOracleInterface(_oracle);
    }

    /**
     * @notice get the live price for the asset
     * @dev overrides the getPrice function in PricerInterface
     * @return price of 1e8 nToken in USD, scaled by 1e8
     */
    function getPrice() external view returns (uint256) {
        uint256 underlyingPrice = oracle.getPrice(address(underlying));
        require(underlyingPrice > 0, "MockNeuronPoolPricer: underlying price is 0");
        return _underlyingPriceTontokenPrice(underlyingPrice);
    }

    /**
     * @notice set the expiry price in the oracle
     * @dev requires that the underlying price has been set before setting a nToken price
     * @param _expiryTimestamp expiry to set a price for
     */
    function setExpiryPriceInOracle(uint256 _expiryTimestamp) external {
        (uint256 underlyingPriceExpiry, ) = oracle.getExpiryPrice(address(underlying), _expiryTimestamp);
        require(underlyingPriceExpiry > 0, "MockNeuronPoolPricer: underlying price not set yet");
        uint256 nTokenPrice = _underlyingPriceTontokenPrice(underlyingPriceExpiry);
        oracle.setExpiryPrice(address(nToken), _expiryTimestamp, nTokenPrice);
    }

    /**
     * @dev convert underlying price to nToken price with the nToken to underlying exchange rate
     * @param _underlyingPrice price of 1 underlying token (ie 1e6 USDC, 1e18 WETH) in USD, scaled by 1e8
     * @return price of 1e8 nToken in USD, scaled by 1e8
     */
    function _underlyingPriceTontokenPrice(uint256 _underlyingPrice) private view returns (uint256) {
        uint256 pricePerShare = nToken.pricePerShare();
        uint8 nTokenDecimals = nToken.decimals();

        return pricePerShare.mul(_underlyingPrice).div(10**uint256(nTokenDecimals));
    }
}
